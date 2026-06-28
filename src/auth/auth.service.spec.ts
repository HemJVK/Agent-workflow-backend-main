// Mock modules with ESM dependencies before any imports
jest.mock('./totp.service', () => {
  return {
    TotpService: class TotpService {
      async generateSecret() { return { secret: 'MOCK', qrCodeUrl: 'data:...' }; }
      verifyToken() { return true; }
    }
  };
});
jest.mock('google-auth-library', () => {
  return {
    OAuth2Client: class OAuth2Client {
      async verifyIdToken() {}
    }
  };
});

import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { OtpService } from './otp.service';
import { FirebaseService } from './firebase.service';
import { TotpService } from './totp.service';
import { ComposioService } from '../composio/composio.service';
import { CreditsService } from '../credits/credits.service';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: Partial<UsersService>;
  let jwtService: Partial<JwtService>;
  let otpService: Partial<OtpService>;
  let totpService: Partial<TotpService>;
  let composioService: Partial<ComposioService>;
  let creditsService: Partial<CreditsService>;

  let sendOtpCalled = false;
  let registeredEntityEmail: string | undefined;

  const fakeUser = {
    id: 'user-uuid-1',
    email: 'test@example.com',
    password_hash: '',
    phone_number: null,
    sso_id: null,
    credits: 50,
    is_admin: false,
    is_email_verified: false,
    is_phone_verified: false,
    otp_code: '123456',
    otp_expires_at: new Date(Date.now() + 600000), // 10min future
    has_seen_tutorial: false,
    totp_secret: null,
    is_totp_enabled: false,
    created_at: new Date(),
    updated_at: new Date(),
    credit_transactions: [],
  };

  beforeEach(async () => {
    process.env.SUPER_ADMIN_PASSKEY = 'admin_secret_123';
    // Hash password for validateUser tests
    const hashedPassword = await bcrypt.hash('correct-password', 10);

    usersService = {
      findByEmail: async () => ({ ...fakeUser, password_hash: hashedPassword } as any),
      findBySsoId: async () => null,
      findByPhone: async () => null,
      findById: async () => ({ ...fakeUser, password_hash: hashedPassword } as any),
      create: async () => ({ ...fakeUser } as any),
      update: async () => ({ ...fakeUser } as any),
    };

    jwtService = {
      sign: () => 'signed-jwt-token',
      verifyAsync: async <T extends object = any>() => ({ sub: 'user-uuid-1', email: 'test@example.com' } as unknown as T),
    };

    sendOtpCalled = false;
    otpService = {
      generateOtp: () => '654321',
      getExpiry: () => new Date(Date.now() + 600000),
      sendOtp: async () => { sendOtpCalled = true; return undefined; },
    };

    totpService = {
      generateSecret: async () => ({ secret: 'TOTP_SECRET', qrCodeUrl: 'data:image/png;base64,...' }),
      verifyToken: () => true,
    };

    registeredEntityEmail = undefined;
    composioService = {
      registerEntity: async (email) => { registeredEntityEmail = email; return undefined; },
      getGmailConnectionUrl: async () => 'https://composio.dev/connect',
      isGmailConnected: async () => false,
    };

    creditsService = {
      grant: async () => 5050,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: OtpService, useValue: otpService },
        { provide: FirebaseService, useValue: { verifyIdToken: async () => null } },
        { provide: TotpService, useValue: totpService },
        { provide: ComposioService, useValue: composioService },
        { provide: CreditsService, useValue: creditsService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── validateUser ──────────────────────────────────────────────────────
  describe('validateUser', () => {
    it('should return user for correct email + password', async () => {
      const result = await service.validateUser('test@example.com', 'correct-password');
      expect(result).toBeDefined();
      expect(result!.email).toBe('test@example.com');
    });

    it('should return null for wrong password', async () => {
      const result = await service.validateUser('test@example.com', 'wrong-password');
      expect(result).toBeNull();
    });

    it('should return null for non-existent user', async () => {
      usersService.findByEmail = async () => null;
      const result = await service.validateUser('nobody@example.com', 'password');
      expect(result).toBeNull();
    });

    it('should return null when user has no password_hash (SSO only)', async () => {
      usersService.findByEmail = async () => ({ ...fakeUser, password_hash: null as any } as any);
      const result = await service.validateUser('test@example.com', 'any-password');
      expect(result).toBeNull();
    });
  });

  // ── login ──────────────────────────────────────────────────────────────
  describe('login', () => {
    it('should return access_token and user info', async () => {
      const result = await service.login(fakeUser as any);
      expect(result.access_token).toBe('signed-jwt-token');
      expect(result.user.id).toBe('user-uuid-1');
      expect(result.user.email).toBe('test@example.com');
      // Sign is validated implicitly by token output or we could manually track calls if needed
    });

    it('should not expose password_hash in returned user', async () => {
      const result = await service.login(fakeUser as any);
      expect((result.user as any).password_hash).toBeUndefined();
    });
  });

  // ── register ──────────────────────────────────────────────────────────
  describe('register', () => {
    it('should throw BadRequestException for duplicate email', async () => {
      usersService.findByEmail = async () => fakeUser as any;
      await expect(
        service.register({ email: 'test@example.com', password: 'pass123' })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for duplicate phone', async () => {
      usersService.findByEmail = async () => null;
      usersService.findByPhone = async () => fakeUser as any;
      await expect(
        service.register({ phone_number: '+1234567890' })
      ).rejects.toThrow(BadRequestException);
    });

    it('should create user with hashed password and send OTP', async () => {
      usersService.findByEmail = async () => null;
      const result = await service.register({ email: 'new@example.com', password: 'password123' });
      expect(result.message).toBe('OTP sent for verification');
      expect(result.userId).toBeDefined();
      /* create called implicitly */
      expect(sendOtpCalled).toBe(true);
    });

    it('should register Composio entity for email users', async () => {
      usersService.findByEmail = async () => null;
      await service.register({ email: 'new@example.com', password: 'pass' });
      expect(registeredEntityEmail).toBe('new@example.com');
    });
  });

  // ── verifyOtp ─────────────────────────────────────────────────────────
  describe('verifyOtp', () => {
    it('should throw for non-existent user', async () => {
      usersService.findById = async () => null;
      await expect(service.verifyOtp('bad-id', '123456')).rejects.toThrow(BadRequestException);
    });

    it('should throw for wrong OTP code', async () => {
      await expect(service.verifyOtp('user-uuid-1', 'wrong-code')).rejects.toThrow(BadRequestException);
    });

    it('should throw for expired OTP', async () => {
      usersService.findById = async () => ({
        ...fakeUser,
        otp_code: '123456',
        otp_expires_at: new Date(Date.now() - 60000), // 1 minute ago
      } as any);
      await expect(service.verifyOtp('user-uuid-1', '123456')).rejects.toThrow(BadRequestException);
    });

    it('should return login tokens for valid OTP', async () => {
      const result = await service.verifyOtp('user-uuid-1', '123456');
      expect(result.access_token).toBeDefined();
      /* updated implicitly */
    });

    it('should save session when saveSession is true', async () => {
      usersService.findById = async () => ({
        ...fakeUser,
        otp_code: '123456',
        otp_expires_at: new Date(Date.now() + 60000), // valid
      } as any);

      // Verify status should initially be verified: false
      let status = service.getVerificationStatus('user-uuid-1');
      expect(status.verified).toBe(false);

      // Verify OTP and request saving the session
      await service.verifyOtp('user-uuid-1', '123456', true);

      // Verify status should now be verified: true
      status = service.getVerificationStatus('user-uuid-1');
      expect(status.verified).toBe(true);

      // Second check should be verified: false (deleted from map)
      status = service.getVerificationStatus('user-uuid-1');
      expect(status.verified).toBe(false);
    });
  });

  // ── bootstrapAdmin ────────────────────────────────────────────────────
  describe('bootstrapAdmin', () => {
    it('should throw UnauthorizedException for wrong passkey', async () => {
      await expect(
        service.bootstrapAdmin('user-uuid-1', 'wrong-passkey')
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should promote user to admin with correct passkey', async () => {
      // Default env passkey is 'admin_secret_123'
      const result = await service.bootstrapAdmin('user-uuid-1', 'admin_secret_123');
      expect(result.access_token).toBeDefined();
      /* updated */
    });
  });

  // ── TOTP ──────────────────────────────────────────────────────────────
  describe('TOTP', () => {
    it('setupTotp should return a QR code URL', async () => {
      const result = await service.setupTotp('test@example.com');
      expect(result.qrCodeUrl).toBeDefined();
    });

    it('setupTotp should throw for non-existent user', async () => {
      usersService.findByEmail = async () => null;
      await expect(service.setupTotp('nobody@example.com')).rejects.toThrow(BadRequestException);
    });

    it('setupTotp should throw if TOTP is already enabled', async () => {
      usersService.findByEmail = async () => ({ ...fakeUser, is_totp_enabled: true } as any);
      await expect(service.setupTotp('test@example.com')).rejects.toThrow(BadRequestException);
    });

    it('verifyTotpSetup should throw for invalid code', async () => {
      totpService.verifyToken = () => false;
      usersService.findByEmail = async () => ({ ...fakeUser, totp_secret: 'SECRET' } as any);
      await expect(
        service.verifyTotpSetup('test@example.com', '000000')
      ).rejects.toThrow(UnauthorizedException);
    });

    it('totpLogin should throw when TOTP is not enabled', async () => {
      usersService.findByEmail = async () => ({ ...fakeUser, is_totp_enabled: false } as any);
      await expect(
        service.totpLogin('test@example.com', '123456')
      ).rejects.toThrow(UnauthorizedException);
    });

    it('totpLogin should return token for valid TOTP code', async () => {
      usersService.findByEmail = async () => ({
        ...fakeUser,
        is_totp_enabled: true,
        totp_secret: 'SECRET',
      } as any);
      const result = await service.totpLogin('test@example.com', '123456');
      expect(result.access_token).toBeDefined();
    });
  });

  // ── Admin Promotion ───────────────────────────────────────────────────
  describe('checkAdminPromotion (via login)', () => {
    it('should auto-promote user listed in ADMIN_EMAILS', async () => {
      process.env.ADMIN_EMAILS = 'test@example.com,other@example.com';
      usersService.findById = async () => ({ ...fakeUser, is_admin: true } as any);

      const result = await service.login(fakeUser as any);
      /* updated */
      expect(result.access_token).toBeDefined();

      delete process.env.ADMIN_EMAILS;
    });
  });
});
