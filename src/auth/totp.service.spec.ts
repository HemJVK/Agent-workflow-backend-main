// Mock otplib and qrcode before importing TotpService
jest.mock('otplib', () => ({
  generateSecret: jest.fn().mockReturnValue('MOCK_SECRET_BASE32'),
  generateURI: jest.fn().mockReturnValue('otpauth://totp/Agent%20Flow:test@example.com?secret=MOCK_SECRET_BASE32&issuer=Agent%20Flow'),
  verifySync: jest.fn().mockReturnValue({ valid: true }),
}));
jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mockQrCodeData'),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { TotpService } from './totp.service';
import { verifySync } from 'otplib';

describe('TotpService', () => {
  let service: TotpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TotpService],
    }).compile();
    service = module.get<TotpService>(TotpService);
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(service).toBeDefined(); });

  describe('generateSecret', () => {
    it('should return a secret and QR code URL', async () => {
      const result = await service.generateSecret('test@example.com');
      expect(result).toHaveProperty('secret');
      expect(result).toHaveProperty('qrCodeUrl');
      expect(result.secret).toBe('MOCK_SECRET_BASE32');
      expect(result.qrCodeUrl).toContain('data:image/png;base64,');
    });
  });

  describe('verifyToken', () => {
    it('should return true for valid token', () => {
      (verifySync as jest.Mock).mockReturnValue({ valid: true });
      expect(service.verifyToken('SECRET', '123456')).toBe(true);
    });

    it('should return false for invalid token', () => {
      (verifySync as jest.Mock).mockReturnValue({ valid: false });
      expect(service.verifyToken('SECRET', '000000')).toBe(false);
    });

    it('should return false when verifySync throws', () => {
      (verifySync as jest.Mock).mockImplementation(() => { throw new Error('bad'); });
      expect(service.verifyToken('SECRET', 'bad')).toBe(false);
    });
  });
});
