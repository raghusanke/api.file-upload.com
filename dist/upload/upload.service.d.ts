export declare class UploadService {
    handleFileUpload(file: Express.Multer.File): {
        message: string;
        fileName: string;
        originalName: string;
        mimeType: string;
        size: number;
        filePath: string;
    };
    fileExists(filePath: string): Promise<boolean>;
}
