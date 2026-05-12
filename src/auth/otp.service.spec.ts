import { Test, TestingModule } from '@nestjs/testing';
import { OtpService } from './otp.service';
import { ConfigService } from '@nestjs/config';

describe('OtpService', () => {
  let service: OtpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(undefined), // No Twilio credentials
          },
        },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── generateOtp ───────────────────────────────────────────────────────
  describe('generateOtp', () => {
    it('should return a 6-digit string', () => {
      const otp = service.generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
    });

    it('should pad numbers less than 6 digits', () => {
      // Run multiple times to increase chance of hitting low numbers
      for (let i = 0; i < 100; i++) {
        const otp = service.generateOtp();
        expect(otp.length).toBe(6);
      }
    });

    it('should generate different codes on successive calls', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 50; i++) {
        codes.add(service.generateOtp());
      }
      // With crypto randomness, 50 calls should produce multiple distinct values
      expect(codes.size).toBeGreaterThan(1);
    });
  });

  // ── getExpiry ──────────────────────────────────────────────────────────
  describe('getExpiry', () => {
    it('should return a Date approximately 10 minutes in the future', () => {
      const before = Date.now();
      const expiry = service.getExpiry();
      const after = Date.now();

      // 10 minutes = 600000 ms. Allow 1s tolerance.
      expect(expiry.getTime()).toBeGreaterThanOrEqual(before + 599000);
      expect(expiry.getTime()).toBeLessThanOrEqual(after + 601000);
    });

    it('should return a Date object', () => {
      const expiry = service.getExpiry();
      expect(expiry).toBeInstanceOf(Date);
    });
  });

  // ── sendOtp ────────────────────────────────────────────────────────────
  describe('sendOtp', () => {
    it('should not throw when Twilio is not configured (mock mode)', async () => {
      await expect(
        service.sendOtp('+1234567890', '123456', 'phone')
      ).resolves.not.toThrow();
    });

    it('should not throw for email type', async () => {
      await expect(
        service.sendOtp('test@example.com', '123456', 'email')
      ).resolves.not.toThrow();
    });
  });

  // ── sendSms ────────────────────────────────────────────────────────────
  describe('sendSms', () => {
    it('should not throw when Twilio is not configured', async () => {
      await expect(
        service.sendSms('+1234567890', 'Test message')
      ).resolves.not.toThrow();
    });
  });
});
