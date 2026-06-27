import type { RPCSchema } from 'electrobun';

export type M2StorageRecord = {
  mapID: string;
  title: string;
  payload: Record<string, unknown>;
};

export type M2StorageSaveRequest = {
  record: M2StorageRecord;
};

export type M2StorageReadRequest = {
  mapID: string;
};

export type M2TextFileRequest = {
  relativePath: string;
  text: string;
};

export type M2ReadFileRequest = {
  relativePath: string;
};

export type M2ViteArtifactStatus = {
  exists: boolean;
  indexPath: string;
};

export type M2ElectrobunRPC = {
  bun: RPCSchema<{
    requests: {
      ping: {
        params: { message: string };
        response: { message: string; runtime: 'bun' };
      };
      storageSaveMock: {
        params: M2StorageSaveRequest;
        response: { ok: true; mapID: string };
      };
      storageReadMock: {
        params: M2StorageReadRequest;
        response: M2StorageRecord | null;
      };
      writeTextFile: {
        params: M2TextFileRequest;
        response: { ok: true; path: string };
      };
      readTextFile: {
        params: M2ReadFileRequest;
        response: { text: string; path: string };
      };
      statViteArtifact: {
        params: undefined;
        response: M2ViteArtifactStatus;
      };
    };
    messages: {
      viewReady: { href: string };
    };
  }>;
  webview: RPCSchema<{
    requests: {
      reportLoaded: {
        params: undefined;
        response: { href: string; title: string };
      };
    };
    messages: {
      smokeResult: {
        ok: boolean;
        details: string;
      };
    };
  }>;
};
