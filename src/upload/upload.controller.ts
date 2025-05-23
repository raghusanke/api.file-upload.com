import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { basename, resolve } from 'path';

@Controller()
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    return this.uploadService.handleFileUpload(file);
  }

  @Get('files/:filename')
  async getFile(@Param('filename') filename: string, @Res() res) {
    const safeFilename = basename(filename); // prevents `../` attacks
    const filePath = resolve('./uploads', safeFilename);
    const exists = await this.uploadService.fileExists(filePath);
    if (!exists) throw new NotFoundException('File not found');
    return res.sendFile(filePath);
  }
}
