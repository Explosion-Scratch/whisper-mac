import { existsSync, readdirSync, statSync, rmSync } from "fs";
import { join } from "path";

/**
 * Unified service for file system operations
 */
export class FileSystemService {
  /**
   * Calculate the total size of a directory recursively
   */
  static calculateDirectorySize(dirPath: string): number {
    try {
      if (!existsSync(dirPath)) {
        return 0;
      }

      let totalSize = 0;
      const items = readdirSync(dirPath);

      for (const item of items) {
        const itemPath = join(dirPath, item);
        const stats = statSync(itemPath);

        if (stats.isDirectory()) {
          totalSize += this.calculateDirectorySize(itemPath);
        } else {
          totalSize += stats.size;
        }
      }

      return totalSize;
    } catch (error) {
      console.warn(`Failed to calculate directory size for ${dirPath}:`, error);
      return 0;
    }
  }

  /**
   * Calculate the size of a single file
   */
  static calculateFileSize(filePath: string): number {
    try {
      if (!existsSync(filePath)) {
        return 0;
      }

      const stats = statSync(filePath);
      return stats.isFile() ? stats.size : 0;
    } catch (error) {
      console.warn(`Failed to calculate file size for ${filePath}:`, error);
      return 0;
    }
  }

  /**
   * Calculate total size of multiple files
   */
  static calculateFilesSize(filePaths: string[]): number {
    return filePaths.reduce((total, filePath) => {
      return total + this.calculateFileSize(filePath);
    }, 0);
  }

  /**
   * Delete a directory and all its contents recursively
   */
  static deleteDirectory(dirPath: string): boolean {
    try {
      if (!existsSync(dirPath)) {
        return true; // Directory doesn't exist, consider it "deleted"
      }

      rmSync(dirPath, { recursive: true, force: true });
      return true;
    } catch (error) {
      console.warn(`Failed to delete directory ${dirPath}:`, error);
      return false;
    }
  }

  /**
   * Delete a single file
   */
  static deleteFile(filePath: string): boolean {
    try {
      if (!existsSync(filePath)) {
        return true; // File doesn't exist, consider it "deleted"
      }

      rmSync(filePath, { force: true });
      return true;
    } catch (error) {
      console.warn(`Failed to delete file ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Delete multiple files
   */
  static deleteFiles(filePaths: string[]): boolean {
    return filePaths.every((filePath) => this.deleteFile(filePath));
  }

  /**
   * Check if a path exists
   */
  static exists(path: string): boolean {
    try {
      return existsSync(path);
    } catch (error) {
      console.warn(`Failed to check existence of ${path}:`, error);
      return false;
    }
  }

  /**
   * Get file or directory stats
   */
  static getStats(path: string) {
    try {
      if (!existsSync(path)) {
        return null;
      }
      return statSync(path);
    } catch (error) {
      console.warn(`Failed to get stats for ${path}:`, error);
      return null;
    }
  }

  /**
   * Format bytes to human readable string
   */
  static formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }
}
