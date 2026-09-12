mergeInto(LibraryManager.library, {
  CoinSort_IsMobileBrowser: function () {
    if (typeof navigator === "undefined") {
      return 0;
    }

    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === "boolean") {
      return navigator.userAgentData.mobile ? 1 : 0;
    }

    var userAgent = navigator.userAgent || navigator.vendor || "";
    var mobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent);
    var touchMac =
      /Macintosh/i.test(userAgent) &&
      typeof navigator.maxTouchPoints === "number" &&
      navigator.maxTouchPoints > 1;

    return mobileUserAgent || touchMac ? 1 : 0;
  },

  CoinSort_GetDevicePixelRatio: function () {
    if (typeof window === "undefined") {
      return 1.0;
    }

    var ratio = Number(window.devicePixelRatio);
    return isFinite(ratio) && ratio > 0 ? ratio : 1.0;
  },

  ArcadeX_Init: function (gameObjectNamePtr) {
    var gameObjectName = UTF8ToString(gameObjectNamePtr) || "ArcadeXBridge";

    if (typeof window === "undefined") {
      return;
    }

    var bridgeState = window.__arcadeXBridgeState;
    if (!bridgeState) {
      bridgeState = {
        gameObjectName: gameObjectName,
        listenerRegistered: false,
        pendingCallbacks: [],
        pendingFlushTimer: null,
        sentRequestIds: {},
        parentOrigin: "*",
      };
      window.__arcadeXBridgeState = bridgeState;
    }

    bridgeState.gameObjectName = gameObjectName;
    // Always postMessage with "*". MiniPay / WebView document.referrer often
    // does not match the ArcadeX shell origin, which silently drops both
    // GAME_PROGRESS_SAVE and shell callbacks.
    bridgeState.parentOrigin = "*";

    bridgeState.getUnityInstance = function () {
      if (window.unityInstance) {
        return window.unityInstance;
      }
      if (window.unityGameInstance) {
        return window.unityGameInstance;
      }
      if (window.gameInstance) {
        return window.gameInstance;
      }
      if (typeof Module !== "undefined" && Module.SendMessage) {
        return {
          SendMessage: function (go, method, value) {
            Module.SendMessage(go, method, value);
          },
        };
      }
      return null;
    };

    bridgeState.deliverToUnity = function (method, value) {
      var instance = bridgeState.getUnityInstance();
      if (instance && instance.SendMessage) {
        instance.SendMessage(bridgeState.gameObjectName, method, value);
        return true;
      }
      return false;
    };

    bridgeState.flushPendingUnityCallbacks = function () {
      if (!bridgeState.pendingCallbacks.length) {
        return;
      }

      bridgeState.pendingCallbacks = bridgeState.pendingCallbacks.filter(function (item) {
        if (Date.now() - item.at > 60000) {
          console.warn(
            "[ArcadeXBridge] Dropped Unity callback (instance unavailable):",
            item.method
          );
          return false;
        }

        return !bridgeState.deliverToUnity(item.method, item.value);
      });

      if (!bridgeState.pendingCallbacks.length && bridgeState.pendingFlushTimer !== null) {
        clearInterval(bridgeState.pendingFlushTimer);
        bridgeState.pendingFlushTimer = null;
      }
    };

    bridgeState.queueUnityCallback = function (method, value) {
      for (var i = 0; i < bridgeState.pendingCallbacks.length; i++) {
        var pending = bridgeState.pendingCallbacks[i];
        if (pending.method === method && pending.value === value) {
          pending.at = Date.now();
          return;
        }
      }

      bridgeState.pendingCallbacks.push({
        method: method,
        value: value,
        at: Date.now(),
      });

      if (bridgeState.pendingFlushTimer === null) {
        bridgeState.pendingFlushTimer = setInterval(bridgeState.flushPendingUnityCallbacks, 200);
      }
    };

    bridgeState.deliverOrQueueUnityCallback = function (method, value) {
      if (!bridgeState.deliverToUnity(method, value)) {
        bridgeState.queueUnityCallback(method, value);
      }
    };

    window.__arcadeXDeliverCallback = function (method, value) {
      var callbackValue = typeof value === "string" ? value : JSON.stringify(value || {});
      bridgeState.deliverOrQueueUnityCallback(method, callbackValue);
    };

    if (!bridgeState.listenerRegistered) {
      bridgeState.listenerRegistered = true;

      window.addEventListener("message", function (event) {
        if (event.source !== window.parent) {
          return;
        }

        var data = event.data;
        if (!data || data.type !== "UNITY_CALLBACK" || !data.method) {
          return;
        }

        var callbackValue = data.value !== undefined ? data.value : data.payload;
        callbackValue =
          typeof callbackValue === "string"
            ? callbackValue
            : JSON.stringify(callbackValue || {});

        bridgeState.deliverOrQueueUnityCallback(data.method, callbackValue);
      });

      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", function () {
          if (document.hidden) {
            bridgeState.deliverOrQueueUnityCallback("OnArcadeXPageHidden", "");
          } else {
            bridgeState.flushPendingUnityCallbacks();
          }
        });
      }

      window.addEventListener("pagehide", function () {
        bridgeState.deliverOrQueueUnityCallback("OnArcadeXPageHidden", "");
      });
      window.addEventListener("pageshow", bridgeState.flushPendingUnityCallbacks);
      window.addEventListener("focus", bridgeState.flushPendingUnityCallbacks);
    }

    bridgeState.flushPendingUnityCallbacks();
  },

  ArcadeX_SendToParent: function (jsonPtr) {
    var json = UTF8ToString(jsonPtr);
    if (typeof window !== "undefined" && window.parent && window.parent !== window) {
      var message = JSON.parse(json);
      var bridgeState = window.__arcadeXBridgeState;
      var requestId = message.requestId ||
        (message.payload && message.payload.requestId);

      if (bridgeState && requestId) {
        var now = Date.now();
        if (bridgeState.sentRequestIds[requestId]) {
          return;
        }

        bridgeState.sentRequestIds[requestId] = now;
        Object.keys(bridgeState.sentRequestIds).forEach(function (id) {
          if (now - bridgeState.sentRequestIds[id] > 600000) {
            delete bridgeState.sentRequestIds[id];
          }
        });
      }

      window.parent.postMessage(message, "*");
    }
  },
});
