declare module 'adm-zip' {
    class AdmZip {
        constructor(fileNameOrRawData?: string | Buffer);
        extractAllTo(targetPath: string, overwrite?: boolean): void;
        addLocalFolder(localPath: string, zipPath?: string): void;
        addLocalFile(localPath: string, zipPath?: string, newName?: string): void;
        getEntries(): AdmZip.IZipEntry[];
        writeZip(targetFileName?: string): void;
        // adm-zip 0.5.x: 内部で toAsyncBuffer を使う非同期版 (MAJOR-2/MINOR-1 対応で使用)
        writeZipPromise(targetFileName?: string, props?: { overwrite?: boolean; perm?: number }): Promise<void>;
        toBuffer(): Buffer;
    }
    namespace AdmZip {
        interface IZipEntry {
            entryName: string;
            getData(): Buffer;
            isDirectory: boolean;
        }
    }
    export = AdmZip;
}
