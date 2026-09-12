using System;
using System.Runtime.InteropServices;
using UnityEngine;

/// <summary>
/// ArcadeX shell bridge for Unity WebGL games.
/// Drop this script + ArcadeXBridge.jslib into your Unity project.
/// </summary>
public class ArcadeXBridge : MonoBehaviour
{
    public static ArcadeXBridge Instance { get; private set; }

    public string GameId { get; private set; }
    public string PlayerName { get; private set; }
    public string WalletAddress { get; private set; }
    public int HighScore { get; private set; }
    public int Level { get; private set; }
    public bool HasLeaderboard { get; private set; }
    public bool ContestLive { get; private set; }
    public bool IsBootstrapReady { get; private set; }
    public ArcadeXBootstrapData BootstrapData { get; private set; }

    public event Action<ArcadeXBootstrapData> OnBootstrapReady;
    public event Action<ArcadeXLeaderboardEntry[]> OnLeaderboardReady;
    public event Action<ArcadeXProgressSaveResult> ProgressSaved;
    public event Action<ArcadeXProgressSaveResult> ProgressReceived;
    public event Action<ArcadeXGameStateLoadResult> GameStateReceived;
    public event Action<ArcadeXGameStateSaveResult> GameStateSaved;
    public event Action<ArcadeXRewardedAdResult> RewardedAdCompleted;
    public event Action<int> OnHighScoreChanged;
    public event Action<int> OnLevelChanged;
    public event Action<ArcadeXLeaderboardSubmitResult> LeaderboardSubmitCompleted;
    /// <summary>Legacy bool callback — fired alongside LeaderboardSubmitCompleted.</summary>
    public event Action<bool> OnScoreSubmitComplete;

    private const string DefaultPlayerName = "Player";
    private bool bootstrapRequested;
    private bool progressRequestPending;
    private int lastLevelSaveSent;
    private float lastLevelSaveSentAt;
    private int lastHighScoreSaveSent;
    private int pendingLevelSave;
    private Action<bool> pendingRewardedAdCallback;
    private bool leaderboardRequestPending;
    private float leaderboardRequestStartedAt;
    private bool gameStateRequestPending;

#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")]
    private static extern void ArcadeX_Init(string gameObjectName);

    [DllImport("__Internal")]
    private static extern void ArcadeX_SendToParent(string json);
#endif

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    private static void Bootstrap()
    {
        if (Instance != null)
        {
            return;
        }

        GameObject bridgeObject = new GameObject(nameof(ArcadeXBridge));
        bridgeObject.AddComponent<ArcadeXBridge>();
    }

    private void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);
            return;
        }

        Instance = this;
        DontDestroyOnLoad(gameObject);
    }

    private void Start()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        ArcadeX_Init(gameObject.name);
#endif
        SendBootstrap();
    }

    public void SendBootstrap()
    {
        if (bootstrapRequested) return;

        bootstrapRequested = true;
        SendMessageToParent(new ArcadeXBridgeMessage { type = "GAME_BOOTSTRAP" });
    }

    /// <summary>
    /// Saves personal best only (RTDB users/{wallet}/games/{gameId}.s).
    /// Does not post to the public leaderboard or charge a fee.
    /// </summary>
    public void SaveProgress(int score)
    {
        if (score <= 0 || score <= Mathf.Max(HighScore, lastHighScoreSaveSent))
        {
            return;
        }

        lastHighScoreSaveSent = score;

        SendMessageToParent(new ArcadeXBridgeMessage
        {
            type = "GAME_PROGRESS_SAVE",
            payload = new ArcadeXScorePayload
            {
                score = score,
                walletAddress = WalletAddress
            }
        });
    }

    /// <summary>Saves the player's current one-based level without a leaderboard submission.</summary>
    public void SaveLevel(int level)
    {
        if (level < 1) return;

        pendingLevelSave = Mathf.Max(pendingLevelSave, level);
        FlushPendingLevelSave();
    }

    /// <summary>
    /// Line Link: save Easy / Medium / Advanced (Hard) levels in one post.
    /// Does not wait for bootstrap — the shell already has the wallet.
    /// </summary>
    public void SaveLineLinkProgress(int easyLevel, int mediumLevel, int advancedLevel)
    {
        easyLevel = Mathf.Max(0, easyLevel);
        mediumLevel = Mathf.Max(0, mediumLevel);
        advancedLevel = Mathf.Max(0, advancedLevel);
        if (easyLevel < 1 && mediumLevel < 1 && advancedLevel < 1)
            return;

        int maxLevel = Mathf.Max(easyLevel, Mathf.Max(mediumLevel, advancedLevel));
        pendingLevelSave = Mathf.Max(pendingLevelSave, maxLevel);

        SendMessageToParent(new ArcadeXLineLinkBridgeMessage
        {
            type = "GAME_PROGRESS_SAVE",
            payload = new ArcadeXLineLinkProgressPayload
            {
                easyLevel = easyLevel,
                mediumLevel = mediumLevel,
                advancedLevel = advancedLevel,
                level = maxLevel,
                value = maxLevel,
                score = maxLevel,
                walletAddress = WalletAddress
            }
        });
    }

    private void SendLevel(int level)
    {
        lastLevelSaveSent = level;
        lastLevelSaveSentAt = Time.realtimeSinceStartup;
        SendMessageToParent(new ArcadeXLevelBridgeMessage
        {
            type = "GAME_PROGRESS_SAVE",
            payload = new ArcadeXLevelPayload
            {
                level = level,
                value = level,
                score = level,
                walletAddress = WalletAddress
            }
        });
    }

    private void FlushPendingLevelSave()
    {
        int levelToSave = pendingLevelSave;
        if (levelToSave < 1)
            return;

        if (levelToSave <= Level)
        {
            pendingLevelSave = 0;
            return;
        }

        // The ArcadeX shell already has the wallet; do not wait for bootstrap
        // callbacks or Unity-side wallet before posting GAME_PROGRESS_SAVE.
        if (levelToSave == lastLevelSaveSent && Time.realtimeSinceStartup - lastLevelSaveSentAt < 2f)
            return;

        SendLevel(levelToSave);
    }

    /// <summary>
    /// Paid leaderboard submit. Shell opens the wallet, verifies payment,
    /// then posts the score to the public leaderboard.
    /// Personal best in RTDB is not modified.
    /// </summary>
    public void SubmitToLeaderboard(int score)
    {
        if (score <= 0)
        {
            return;
        }

        SendMessageToParent(new ArcadeXBridgeMessage
        {
            type = "GAME_LEADERBOARD_SUBMIT",
            payload = new ArcadeXScorePayload
            {
                score = score,
                walletAddress = WalletAddress
            }
        });
    }

    /// <summary>Alias for SubmitToLeaderboard — older game code may call this.</summary>
    public void SubmitScore(int score) => SubmitToLeaderboard(score);

    public void RequestLeaderboard()
    {
        if (leaderboardRequestPending && Time.realtimeSinceStartup - leaderboardRequestStartedAt < 15f)
            return;

        leaderboardRequestPending = true;
        leaderboardRequestStartedAt = Time.realtimeSinceStartup;
        SendMessageToParent(new ArcadeXBridgeMessage { type = "GAME_LEADERBOARD_GET" });
    }

    public void RequestProgress()
    {
        if (progressRequestPending) return;

        progressRequestPending = true;
        SendMessageToParent(new ArcadeXBridgeMessage { type = "GAME_PROGRESS_GET" });
    }

    /// <summary>
    /// Requests this game's compact checkpoint once. The ArcadeX shell should read only
    /// the authenticated player's game-state node and reply through OnGameStateReceived.
    /// This is intentionally a one-shot request, not a realtime Firebase listener.
    /// </summary>
    public void RequestGameState(string requestId = null)
    {
        if (gameStateRequestPending)
            return;

        gameStateRequestPending = true;
        SendMessageToParent(new ArcadeXBridgeMessage
        {
            type = "GAME_STATE_GET",
            requestId = requestId
        });
    }

    /// <summary>
    /// Sends one coalesced checkpoint to the ArcadeX shell. The shell owns Firebase auth
    /// and should write payload.state to the current user's path in a single operation.
    /// </summary>
    public void SaveGameState(ArcadeXCloudGameState state, long baseRevision, string requestId)
    {
        if (state == null)
            return;

        SendMessageToParent(new ArcadeXGameStateBridgeMessage
        {
            type = "GAME_STATE_SAVE",
            payload = new ArcadeXGameStateSavePayload
            {
                walletAddress = WalletAddress,
                baseRevision = baseRevision,
                requestId = requestId,
                state = state
            }
        });
    }

    public void RequestRewardedAd(string placementId, Action<bool> callback)
    {
        if (pendingRewardedAdCallback != null)
        {
            callback?.Invoke(false);
            return;
        }

        pendingRewardedAdCallback = callback;
        SendMessageToParent(new ArcadeXRewardedAdBridgeMessage
        {
            type = "GAME_REWARDED_AD_REQUEST",
            payload = new ArcadeXRewardedAdPayload { placementId = placementId }
        });
    }

    /// <summary>
    /// Ask the shell to re-send the last paid submit result (after wallet / reload).
    /// </summary>
    public void PollSubmitResult()
    {
        SendMessageToParent(new ArcadeXBridgeMessage { type = "GAME_LEADERBOARD_SUBMIT_POLL" });
    }

    private void SendMessageToParent(object message)
    {
        string json = JsonUtility.ToJson(message);
#if UNITY_WEBGL && !UNITY_EDITOR
        ArcadeX_SendToParent(json);
#else
        Debug.Log("[ArcadeXBridge] Would send: " + json);
#endif
    }

    public void OnBootstrapDataReceived(string json)
    {
        ArcadeXBootstrapData data = JsonUtility.FromJson<ArcadeXBootstrapData>(json);
        if (data == null)
            return;

        BootstrapData = data;
        GameId = data.gameId;
        PlayerName = data.playerName;
        WalletAddress = data.walletAddress;
        ApplyHighScore(data.highScore);
        ApplyLevel(Mathf.Max(data.level, data.value));
        ApplyLevel(Mathf.Max(data.easyLevel, Mathf.Max(data.mediumLevel, data.advancedLevel)));
        HasLeaderboard = data.hasLeaderboard;
        ContestLive = data.contestLive;
        IsBootstrapReady = true;
        OnBootstrapReady?.Invoke(data);

        // Modern ArcadeX bootstrap normally contains progress. Fall back to a
        // one-shot progress request only when it did not provide a positive value.
        if (Level < 1)
            RequestProgress();

        FlushPendingLevelSave();
    }

    public void OnWalletAddressResolved(string walletAddress)
    {
        WalletAddress = walletAddress;
        FlushPendingLevelSave();
    }

    public void OnLeaderboardReceived(string json)
    {
        leaderboardRequestPending = false;
        ArcadeXLeaderboardWrapper wrapper = JsonUtility.FromJson<ArcadeXLeaderboardWrapper>("{\"entries\":" + json + "}");
        OnLeaderboardReady?.Invoke(wrapper.entries ?? Array.Empty<ArcadeXLeaderboardEntry>());
    }

    public void OnProgressSaved(string json)
    {
        ArcadeXProgressSaveResult result = JsonUtility.FromJson<ArcadeXProgressSaveResult>(json);
        if (result.success)
        {
            ApplyHighScore(result.highScore);
            ApplyLevel(ResolveProgressLevel(result));
            FlushPendingLevelSave();
        }
        else
        {
            pendingLevelSave = Mathf.Max(pendingLevelSave, lastLevelSaveSent);
            lastLevelSaveSent = Level;
            lastLevelSaveSentAt = 0f;
            lastHighScoreSaveSent = HighScore;
            FlushPendingLevelSave();
        }
        ProgressSaved?.Invoke(result);
    }

    /// <summary>
    /// Legacy callback — free saves and paid leaderboard submits both use this name.
    /// Payloads with leaderboardScore route to LeaderboardSubmitCompleted.
    /// </summary>
    public void OnScoreSubmitted(string json)
    {
        if (json.Contains("\"leaderboardScore\""))
        {
            OnLeaderboardSubmitComplete(json);
            return;
        }

        OnProgressSaved(json);
    }

    public void OnProgressReceived(string json)
    {
        progressRequestPending = false;
        ArcadeXProgressSaveResult result = JsonUtility.FromJson<ArcadeXProgressSaveResult>(json);
        if (result.success)
        {
            ApplyHighScore(result.highScore);
            ApplyLevel(ResolveProgressLevel(result));
            FlushPendingLevelSave();
        }
        ProgressReceived?.Invoke(result);
    }

    public void OnGameStateReceived(string json)
    {
        gameStateRequestPending = false;
        ArcadeXGameStateLoadResult result = JsonUtility.FromJson<ArcadeXGameStateLoadResult>(json);
        GameStateReceived?.Invoke(result ?? new ArcadeXGameStateLoadResult
        {
            success = false,
            error = "ArcadeX returned an empty game-state response."
        });
    }

    public void OnGameStateSaved(string json)
    {
        ArcadeXGameStateSaveResult result = JsonUtility.FromJson<ArcadeXGameStateSaveResult>(json);
        GameStateSaved?.Invoke(result ?? new ArcadeXGameStateSaveResult
        {
            success = false,
            error = "ArcadeX returned an empty game-state save response."
        });
    }

    public void OnArcadeXPageHidden(string unused)
    {
        ArcadeXCloudSaveService.RequestImmediateCheckpoint();
        FlushPendingLevelSave();
    }

    public void OnRewardedAdComplete(string json)
    {
        ArcadeXRewardedAdResult result = JsonUtility.FromJson<ArcadeXRewardedAdResult>(json) ??
                                         new ArcadeXRewardedAdResult();
        Action<bool> callback = pendingRewardedAdCallback;
        pendingRewardedAdCallback = null;
        RewardedAdCompleted?.Invoke(result);
        callback?.Invoke(result.success && result.earnedReward);
    }

    private void ApplyHighScore(int highScore)
    {
        if (highScore < 0)
        {
            return;
        }

        if (HighScore == highScore)
        {
            return;
        }

        HighScore = highScore;
        OnHighScoreChanged?.Invoke(HighScore);
    }

    private void ApplyLevel(int level)
    {
        if (level < 1 || level <= Level) return;
        Level = level;
        lastLevelSaveSent = Mathf.Max(lastLevelSaveSent, level);
        OnLevelChanged?.Invoke(Level);
    }

    private static int ResolveProgressLevel(ArcadeXProgressSaveResult result)
    {
        if (result == null)
            return 0;

        // Level games ignore highScore. Line Link also reports per-mode levels.
        int scalar = Mathf.Max(result.level, Mathf.Max(result.value, result.score));
        int modes = Mathf.Max(
            result.easyLevel,
            Mathf.Max(result.mediumLevel, result.advancedLevel)
        );
        return Mathf.Max(scalar, modes);
    }

    public void OnLeaderboardSubmitComplete(string json)
    {
        Debug.Log("[ArcadeXBridge] OnLeaderboardSubmitComplete: " + json);
        ArcadeXLeaderboardSubmitResult result =
            JsonUtility.FromJson<ArcadeXLeaderboardSubmitResult>(json);
        LeaderboardSubmitCompleted?.Invoke(result);
        OnScoreSubmitComplete?.Invoke(result.success);
    }
}

[Serializable]
public class ArcadeXBridgeMessage
{
    public string type;
    public string requestId;
    public ArcadeXScorePayload payload;
}

[Serializable]
public class ArcadeXLevelBridgeMessage
{
    public string type;
    public ArcadeXLevelPayload payload;
}

[Serializable]
public class ArcadeXGameStateBridgeMessage
{
    public string type;
    public ArcadeXGameStateSavePayload payload;
}

[Serializable]
public class ArcadeXGameStateSavePayload
{
    public string walletAddress;
    public long baseRevision;
    public string requestId;
    public ArcadeXCloudGameState state;
}

[Serializable]
public class ArcadeXRewardedAdBridgeMessage
{
    public string type;
    public ArcadeXRewardedAdPayload payload;
}

[Serializable]
public class ArcadeXRewardedAdPayload
{
    public string placementId;
}

[Serializable]
public class ArcadeXScorePayload
{
    public string name;
    public int score;
    public string walletAddress;
}

[Serializable]
public class ArcadeXLevelPayload
{
    public int level;
    public int value;
    public int score;
    public string walletAddress;
}

[Serializable]
public class ArcadeXLineLinkBridgeMessage
{
    public string type;
    public ArcadeXLineLinkProgressPayload payload;
}

[Serializable]
public class ArcadeXLineLinkProgressPayload
{
    public int easyLevel;
    public int mediumLevel;
    public int advancedLevel;
    public int level;
    public int value;
    public int score;
    public string walletAddress;
}

[Serializable]
public class ArcadeXBootstrapData
{
    public string gameId;
    public string shellOrigin;
    public string walletAddress;
    public string playerName;
    public int highScore;
    public int level;
    public int value;
    public int easyLevel;
    public int mediumLevel;
    public int advancedLevel;
    public bool hasLeaderboard;
    public bool contestLive;
    public int hints;
    public bool tutorialComplete;
    public bool gamePurchased;
    // Optional: the shell can include this in its existing bootstrap read so Unity
    // does not need a second Firebase download for GAME_STATE_GET.
    public bool gameStateIncluded;
    public bool gameStateFound;
    public ArcadeXCloudGameState gameState;
}

[Serializable]
public class ArcadeXLeaderboardEntry
{
    public string name;
    public int score;
    public string walletAddress;
    public long createdAt;
}

[Serializable]
public class ArcadeXLeaderboardWrapper
{
    public ArcadeXLeaderboardEntry[] entries;
}

[Serializable]
public class ArcadeXProgressSaveResult
{
    public bool success;
    public int highScore;
    public int level;
    public int value;
    public int score;
    public int easyLevel;
    public int mediumLevel;
    public int advancedLevel;
    public string error;
}

[Serializable]
public class ArcadeXGameStateLoadResult
{
    public bool success;
    public bool found;
    public string requestId;
    public ArcadeXCloudGameState state;
    public string error;
}

[Serializable]
public class ArcadeXGameStateSaveResult
{
    public bool success;
    public bool conflict;
    public long revision;
    public string requestId;
    public ArcadeXCloudGameState state;
    public string error;
}

[Serializable]
public class ArcadeXRewardedAdResult
{
    public bool success;
    public bool earnedReward;
    public string error;
}

[Serializable]
public class ArcadeXLeaderboardSubmitResult
{
    public bool success;
    public int highScore;
    public int leaderboardScore;
    public string error;
}
