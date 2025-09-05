import crypto from 'crypto';

export class EncryptionService {
    private key: Buffer;
    private iv: Buffer;

    constructor(encryptionKey: string, iv: string) {
        this.key = this.generateKey(encryptionKey);
        this.iv = Buffer.from(iv, 'utf8');

        // Validate IV length (must be 16 bytes for AES)
        if (this.iv.length !== 16) {
            throw new Error('IV must be exactly 16 bytes (128 bits)');
        }
    }

    // Generate a 256-bit key from any input string (matches Flutter implementation)
    private generateKey(input: string): Buffer {
        return crypto.createHash('sha256').update(input, 'utf8').digest();
    }

    // Main encryption method - handles different data types
    encryptData(data: any): any {
        if (typeof data === 'string') {
            return this.encryptString(data);
        } else if (Array.isArray(data)) {
            return data.map(item => this.encryptData(item));
        } else if (data && typeof data === 'object') {
            return this.encryptMap(data);
        } else {
            return this.encryptString(JSON.stringify(data));
        }
    }

    // Main decryption method - handles different data types
    decryptData(data: any): any {
        if (typeof data === 'string') {
            return this.decryptString(data);
        } else if (Array.isArray(data)) {
            return data.map(item => this.decryptData(item));
        } else if (data && typeof data === 'object') {
            return this.decryptMap(data);
        } else {
            try {
                return JSON.parse(this.decryptData(data));
            } catch {
                return data;
            }
        }
    }

    // Encrypt a string
    private encryptString(text: string): string {
        const cipher = crypto.createCipheriv('aes-256-cbc', Uint8Array.from(this.key), Uint8Array.from(this.iv));
        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        return encrypted;
    }

    // Decrypt a string
    private decryptString(encryptedText: string): string {
        try {
            const decipher = crypto.createDecipheriv('aes-256-cbc', Uint8Array.from(this.key), Uint8Array.from(this.iv));
            let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            // If we can't decrypt it, return the original (matches Flutter behavior)
            return encryptedText;
        }
    }

    // Encrypt a map/object
    private encryptMap(map: Record<string, any>): Record<string, any> {
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(map)) {
            if (typeof value === 'string') {
                result[key] = this.encryptString(value);
            } else {
                result[key] = this.encryptData(value);
            }
        }
        return result;
    }

    // Decrypt a map/object
    private decryptMap(map: Record<string, any>): Record<string, any> {
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(map)) {
            if (typeof value === 'string') {
                try {
                    result[key] = this.decryptString(value);
                } catch {
                    result[key] = value;
                }
            } else {
                result[key] = this.decryptData(value);
            }
        }
        return result;
    }

    // Get the current IV as base64 string
    getIVBase64(): string {
        return this.iv.toString('base64');
    }

    // Static factory method to create instance with base64 IV
    static withIV(encryptionKey: string, ivBase64: string): EncryptionService {
        const iv = Buffer.from(ivBase64, 'base64');

        if (iv.length !== 16) {
            throw new Error('IV must be exactly 16 bytes (128 bits)');
        }

        // Convert buffer back to string for constructor
        const ivString = iv.toString('binary');
        return new EncryptionService(encryptionKey, ivString);
    }
}

// Middleware function to handle encryption/decryption based on headers
export function createEncryptionMiddleware(encryptionKey: string, iv: string) {
    const encryptionService = new EncryptionService(encryptionKey, iv);

    return {
        // Process request data (always decrypt regardless of header, as requested)
        processRequest: (data: any): any => {
            console.log('[Encryption] Decrypting incoming request data');
            return encryptionService.decryptData(data);
        },

        // Process response data (always encrypt regardless of header, as requested)
        processResponse: (data: any): any => {
            console.log('[Encryption] Encrypting outgoing response data');
            return encryptionService.encryptData(data);
        },

        // Get the encryption service instance
        getService: () => encryptionService
    };
}
