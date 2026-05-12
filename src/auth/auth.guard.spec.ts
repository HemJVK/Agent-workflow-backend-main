import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from './auth.guard';
import { JwtService } from '@nestjs/jwt';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let jwtService: jest.Mocked<JwtService>;

  const createMockContext = (authHeader?: string): ExecutionContext => {
    const mockRequest = {
      headers: {
        authorization: authHeader,
      },
    };

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as any;
  };

  beforeEach(async () => {
    process.env.JWT_SECRET = 'fallback_secret_key_123';
    jwtService = {
      verifyAsync: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthGuard,
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    guard = module.get<AuthGuard>(AuthGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow request with valid Bearer token', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', email: 'test@example.com' });
    const context = createMockContext('Bearer valid-jwt-token');

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should attach user payload to request object', async () => {
    const payload = { sub: 'user-1', email: 'test@example.com', is_admin: false };
    jwtService.verifyAsync.mockResolvedValue(payload);
    const context = createMockContext('Bearer valid-token');

    await guard.canActivate(context);

    const request = context.switchToHttp().getRequest();
    expect(request['user']).toEqual(payload);
  });

  it('should throw UnauthorizedException when no Authorization header', async () => {
    const context = createMockContext(undefined);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException for non-Bearer scheme', async () => {
    const context = createMockContext('Basic dGVzdDp0ZXN0');
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException for invalid/expired token', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const context = createMockContext('Bearer expired-token');
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException for malformed token', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt malformed'));
    const context = createMockContext('Bearer not.a.real.token');
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw when Authorization header is empty string', async () => {
    const context = createMockContext('');
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
