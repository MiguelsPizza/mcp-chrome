#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import nativeMessagingHostInstance from './native-messaging-host';
import serverInstance from './server';

const logFile = join(__dirname, 'native-server.log');

const log = (message: string) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  try {
    appendFileSync(logFile, logMessage);
  } catch (error) {
    // If we can't write to log, silently continue
  }
};

try {
  log('Starting native server...');
  serverInstance.setNativeHost(nativeMessagingHostInstance); // Server needs setNativeHost method
  nativeMessagingHostInstance.setServer(serverInstance); // NativeHost needs setServer method
  nativeMessagingHostInstance.start();
  log('Native server started successfully');
} catch (error) {
  log(`Error starting server: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

process.on('error', (error) => {
  log(`Process error: ${error.message}`);
  process.exit(1);
});

// Handle process signals and uncaught exceptions
process.on('SIGINT', () => {
  log('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('exit', (code) => {
  log(`Process exiting with code: ${code}`);
});

process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.message}\nStack: ${error.stack}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  // Don't exit immediately, let the program continue running
});
