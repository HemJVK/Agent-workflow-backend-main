import { Test, TestingModule } from '@nestjs/testing';
import { AdminGuard } from './admin.guard';
import { JwtService } from '@nestjs/jwt';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';

describe('AdminGuard', () => {
  let guard: AdminGuard;
  let jwtService: jest.Mocked<JwtService>;

  const createCtx = (auth?: string): ExecutionContext => {
    // AdminGuard extends AuthGuard which mutates `request['user']` via verifyAsync.
    // The mock must return a real request object that gets mutated.
    const mockRequest: Record<string, any> = {
      headers: { authorization: auth },
    };

    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as any;
  };

  beforeEach(async () => {
    process.env.JWT_SECRET = 'fallback_secret_key_123';
    jwtService = { verifyAsync: jest.fn() } as any;
    const mod: TestingModule = await Test.createTestingModule({
      providers: [AdminGuard, { provide: JwtService, useValue: jwtService }],
    }).compile();
    guard = mod.get<AdminGuard>(AdminGuard);
  });

  it('allows admin users', async () => {
    // verifyAsync returns the payload that AuthGuard attaches to request['user']
    jwtService.verifyAsync.mockResolvedValue({ sub: '1', is_admin: true });
    const result = await guard.canActivate(createCtx('Bearer valid-admin-token'));
    expect(result).toBe(true);
  });

  it('rejects non-admin users', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: '2', is_admin: false });
    await expect(guard.canActivate(createCtx('Bearer valid-token'))).rejects.toThrow(ForbiddenException);
  });

  it('rejects unauthenticated requests', async () => {
    await expect(guard.canActivate(createCtx(undefined))).rejects.toThrow(UnauthorizedException);
  });
});
