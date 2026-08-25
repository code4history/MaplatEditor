declare module 'adm-zip' {
    class AdmZip {
        constructor(fileNameOrRawData?: string | Buffer);
        extractAllTo(targetPath: string, overwrite?: boolean): void;
        addLocalFolder(localPath: string, zipPath?: string): void;
        addLocalFile(localPath: string, zipPath?: string, newName?: string): void;
        addFile(entryName: string, content: Buffer, comment?: string, attr?: number): void;
        getEntries(): AdmZip.IZipEntry[];
        writeZip(targetFileName?: string): void;
        // adm-zip 0.6.x: 内部で toAsyncBuffer を使う非同期版。zip 全体を単一 Buffer へ連結する
        // 全メモリ方式のため、大規模データには使わない（t1: アプリ搬出は electron/utils/zipWriter.ts
        // のストリーミング実装へ移行済み。型宣言は mapDownloadZip 等の将来利用のため残す）
        writeZipPromise(targetFileName?: string, props?: { overwrite?: boolean; perm?: number }): Promise<void>;
        toBuffer(): Buffer;
    }
    namespace AdmZip {
        interface IZipEntry {
            entryName: string;
            getData(): Buffer;
            isDirectory: boolean;
            header: { attr: number; size: number };
        }
    }
    export = AdmZip;
}
