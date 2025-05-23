import { UploadService } from './upload.service';
export declare class UploadController {
    private readonly uploadService;
    constructor(uploadService: UploadService);
    uploadFile(file: Express.Multer.File): {
        message: string;
        fileName: string;
        originalName: string;
        mimeType: string;
        size: number;
        filePath: string;
    };
    getFile(filename: string, res: any): Promise<any>;
}
