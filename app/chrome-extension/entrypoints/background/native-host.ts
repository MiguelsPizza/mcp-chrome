import { NativeMessageType } from 'chrome-mcp-shared';
import {
  ERROR_MESSAGES,
  ICONS,
  NATIVE_HOST,
  NOTIFICATIONS,
  STORAGE_KEYS,
  SUCCESS_MESSAGES,
} from '@/common/constants';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';
import { handleCallTool } from './tools';

let nativePort: chrome.runtime.Port | null = null;
export const HOST_NAME = NATIVE_HOST.NAME;

/**
 * Server status management interface
 */
interface ServerStatus {
  isRunning: boolean;
  port?: number;
  lastUpdated: number;
}

let currentServerStatus: ServerStatus = {
  isRunning: false,
  lastUpdated: Date.now(),
};

/**
 * Save server status to chrome.storage
 */
async function saveServerStatus(status: ServerStatus): Promise<void> {
  try {
    console.log('[native] Saving server status to storage:', status);
    await chrome.storage.local.set({ [STORAGE_KEYS.SERVER_STATUS]: status });
    console.log('[native] Server status saved successfully');
  } catch (error) {
    console.error('[native]', ERROR_MESSAGES.SERVER_STATUS_SAVE_FAILED, error);
  }
}

/**
 * Load server status from chrome.storage
 */
async function loadServerStatus(): Promise<ServerStatus> {
  try {
    console.log('[native] Loading server status from storage');
    const result = await chrome.storage.local.get([STORAGE_KEYS.SERVER_STATUS]);
    if (result[STORAGE_KEYS.SERVER_STATUS]) {
      console.log('[native] Loaded server status:', result[STORAGE_KEYS.SERVER_STATUS]);
      return result[STORAGE_KEYS.SERVER_STATUS];
    }
    console.log('[native] No server status found in storage, using default');
  } catch (error) {
    console.error('[native]', ERROR_MESSAGES.SERVER_STATUS_LOAD_FAILED, error);
  }
  const defaultStatus = {
    isRunning: false,
    lastUpdated: Date.now(),
  };
  console.log('[native] Returning default server status:', defaultStatus);
  return defaultStatus;
}

/**
 * Broadcast server status change to all listeners
 */
function broadcastServerStatusChange(status: ServerStatus): void {
  console.log('[native] Broadcasting server status change:', status);
  chrome.runtime
    .sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.SERVER_STATUS_CHANGED,
      payload: status,
    })
    .then(() => {
      console.log('[native] Server status broadcast successful');
    })
    .catch(() => {
      // Ignore errors if no listeners are present
      console.log('[native] No listeners for server status broadcast (this is normal)');
    });
}

/**
 * Connect to the native messaging host
 */
export function connectNativeHost(port: number = NATIVE_HOST.DEFAULT_PORT) {
  if (nativePort) {
    console.log('[native] Native port already connected, skipping connection');
    return;
  }

  try {
    console.log(`[native] Attempting to connect to native host: ${HOST_NAME} on port ${port}`);
    nativePort = chrome.runtime.connectNative(HOST_NAME);
    console.log('[native] Native port connection established');

    nativePort.onMessage.addListener(async (message) => {
      console.log('[native] Received message from native host:', message);

      // chrome.notifications.create({
      //   type: NOTIFICATIONS.TYPE,
      //   iconUrl: chrome.runtime.getURL(ICONS.NOTIFICATION),
      //   title: 'Message from native host',
      //   message: `Received data from host: ${JSON.stringify(message)}`,
      //   priority: NOTIFICATIONS.PRIORITY,
      // });

      if (message.type === NativeMessageType.PROCESS_DATA && message.requestId) {
        console.log(`[native] Processing data request with ID: ${message.requestId}`);
        const requestId = message.requestId;
        const requestPayload = message.payload;

        const response = {
          responseToRequestId: requestId,
          payload: {
            status: 'success',
            message: SUCCESS_MESSAGES.TOOL_EXECUTED,
            data: requestPayload,
          },
        };
        console.log('[native] Sending process data response:', response);
        nativePort?.postMessage(response);
      } else if (message.type === NativeMessageType.CALL_TOOL && message.requestId) {
        console.log(
          `[native] Handling tool call request with ID: ${message.requestId}`,
          message.payload,
        );
        const requestId = message.requestId;
        try {
          const result = await handleCallTool(message.payload);
          console.log('[native] Tool call successful, result:', result);
          const successResponse = {
            responseToRequestId: requestId,
            payload: {
              status: 'success',
              message: SUCCESS_MESSAGES.TOOL_EXECUTED,
              data: result,
            },
          };
          console.log('[native] Sending tool call success response:', successResponse);
          nativePort?.postMessage(successResponse);
        } catch (error) {
          console.error('[native] Tool call failed:', error);
          const errorResponse = {
            responseToRequestId: requestId,
            payload: {
              status: 'error',
              message: ERROR_MESSAGES.TOOL_EXECUTION_FAILED,
              error: error instanceof Error ? error.message : String(error),
            },
          };
          console.log('[native] Sending tool call error response:', errorResponse);
          nativePort?.postMessage(errorResponse);
        }
      } else if (message.type === NativeMessageType.SERVER_STARTED) {
        const port = message.payload?.port;
        console.log(`[native] Server started notification received for port: ${port}`);
        currentServerStatus = {
          isRunning: true,
          port: port,
          lastUpdated: Date.now(),
        };
        await saveServerStatus(currentServerStatus);
        broadcastServerStatusChange(currentServerStatus);
        console.log(`[native] ${SUCCESS_MESSAGES.SERVER_STARTED} on port ${port}`);
      } else if (message.type === NativeMessageType.SERVER_STOPPED) {
        console.log('[native] Server stopped notification received');
        currentServerStatus = {
          isRunning: false,
          port: currentServerStatus.port, // Keep last known port for reconnection
          lastUpdated: Date.now(),
        };
        await saveServerStatus(currentServerStatus);
        broadcastServerStatusChange(currentServerStatus);
        console.log(`[native] ${SUCCESS_MESSAGES.SERVER_STOPPED}`);
      } else if (message.type === NativeMessageType.ERROR_FROM_NATIVE_HOST) {
        const errorMessage = message.payload?.message || 'Unknown error';
        console.error('[native] Error from native host:', errorMessage);
      } else {
        console.warn('[native] Received unknown message type from native host:', message.type);
      }
    });

    nativePort.onDisconnect.addListener(() => {
      console.error('[native]', ERROR_MESSAGES.NATIVE_DISCONNECTED, chrome.runtime.lastError);
      nativePort = null;
      console.log('[native] Native port set to null after disconnect');
    });

    const startMessage = { type: NativeMessageType.START, payload: { port } };
    console.log('[native] Sending start message to native host:', startMessage);
    nativePort.postMessage(startMessage);
  } catch (error) {
    console.error('[native]', ERROR_MESSAGES.NATIVE_CONNECTION_FAILED, error);
  }
}

/**
 * Initialize native host listeners and load initial state
 */
export const initNativeHostListener = () => {
  console.log('[native] Initializing native host listener');

  // Initialize server status from storage
  loadServerStatus()
    .then((status) => {
      currentServerStatus = status;
      console.log('[native] Server status initialized from storage:', status);
    })
    .catch((error) => {
      console.error('[native]', ERROR_MESSAGES.SERVER_STATUS_LOAD_FAILED, error);
    });

  chrome.runtime.onStartup.addListener(() => {
    console.log('[native] Chrome runtime startup detected, connecting native host');
    connectNativeHost();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.log('[native] Received runtime message:', message);

    if (
      message === NativeMessageType.CONNECT_NATIVE ||
      message.type === NativeMessageType.CONNECT_NATIVE
    ) {
      const port =
        typeof message === 'object' && message.port ? message.port : NATIVE_HOST.DEFAULT_PORT;
      console.log(`[native] Connect native request received for port: ${port}`);
      connectNativeHost(port);
      const response = { success: true, port };
      console.log('[native] Sending connect response:', response);
      sendResponse(response);
      return true;
    }

    if (message.type === NativeMessageType.PING_NATIVE) {
      const connected = nativePort !== null;
      console.log(`[native] Ping native request received, connected: ${connected}`);
      const response = { connected };
      console.log('[native] Sending ping response:', response);
      sendResponse(response);
      return true;
    }

    if (message.type === NativeMessageType.DISCONNECT_NATIVE) {
      console.log('[native] Disconnect native request received');
      if (nativePort) {
        console.log('[native] Disconnecting native port');
        nativePort.disconnect();
        nativePort = null;
        const response = { success: true };
        console.log('[native] Sending disconnect success response:', response);
        sendResponse(response);
      } else {
        console.log('[native] No active connection to disconnect');
        const response = { success: false, error: 'No active connection' };
        console.log('[native] Sending disconnect error response:', response);
        sendResponse(response);
      }
      return true;
    }

    if (message.type === BACKGROUND_MESSAGE_TYPES.GET_SERVER_STATUS) {
      console.log('[native] Get server status request received');
      const response = {
        success: true,
        serverStatus: currentServerStatus,
        connected: nativePort !== null,
      };
      console.log('[native] Sending server status response:', response);
      sendResponse(response);
      return true;
    }

    if (message.type === BACKGROUND_MESSAGE_TYPES.REFRESH_SERVER_STATUS) {
      console.log('[native] Refresh server status request received');
      loadServerStatus()
        .then((storedStatus) => {
          currentServerStatus = storedStatus;
          const response = {
            success: true,
            serverStatus: currentServerStatus,
            connected: nativePort !== null,
          };
          console.log('[native] Sending refresh status success response:', response);
          sendResponse(response);
        })
        .catch((error) => {
          console.error('[native]', ERROR_MESSAGES.SERVER_STATUS_LOAD_FAILED, error);
          const response = {
            success: false,
            error: ERROR_MESSAGES.SERVER_STATUS_LOAD_FAILED,
            serverStatus: currentServerStatus,
            connected: nativePort !== null,
          };
          console.log('[native] Sending refresh status error response:', response);
          sendResponse(response);
        });
      return true;
    }

    console.log('[native] Unhandled runtime message type:', message.type || 'no type');
  });

  console.log('[native] Native host listener initialization complete');
};
