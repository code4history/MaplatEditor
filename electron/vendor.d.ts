declare module 'adm-zip' {
    class AdmZip {
        constructor(fileNameOrRawData?: string | Buffer);
        extractAllTo(targetPath: string, overwrite?: boolean): void;
        addLocalFolder(localPath: string, zipPath?: string): void;
        addLocalFile(localPath: string, zipPath?: string, newName?: string): void;
        getEntries(): AdmZip.IZipEntry[];
        writeZip(targetFileName?: string): void;
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
