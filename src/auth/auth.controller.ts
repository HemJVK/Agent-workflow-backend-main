import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  Get,
  UseGuards,
  Request,
  BadRequestException,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { AuthGuard } from './auth.guard';
import { ComposioService } from '../composio/composio.service';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
    private composioService: ComposioService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() body: any) {
    if (!body.email || !body.password) {
      throw new UnauthorizedException('Please provide email and password');
    }
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.authService.login(user);
  }

  @Post('register')
  async register(@Body() body: any) {
    return this.authService.register({
      email: body.email,
      password: body.password,
      phone_number: body.phone_number,
      sso_id: body.sso_id,
    });
  }

  @Post('verify-otp')
  async verifyOtp(@Body() body: any) {
    if (!body.userId || !body.code) {
      throw new UnauthorizedException('UserId and code are required');
    }
    return this.authService.verifyOtp(body.userId, body.code);
  }

  @Get('verify-link')
  async verifyLink(
    @Query('userId') userId: string,
    @Query('code') code: string,
    @Res() res: any,
  ) {
    if (!userId || !code) {
      throw new BadRequestException('UserId and code are required');
    }
    try {
      await this.authService.verifyOtp(userId, code, true);
      res.setHeader('Content-Type', 'text/html');
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Email Verified</title>
            <style>
              body {
                background-color: #000;
                color: #fff;
                font-family: system-ui, -apple-system, sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
              }
              .card {
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.1);
                padding: 2.5rem;
                border-radius: 1.5rem;
                text-align: center;
                max-width: 400px;
              }
              h1 { color: #3b82f6; margin-bottom: 0.5rem; }
              p { color: #9ca3af; font-size: 0.95rem; line-height: 1.5; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Email Verified!</h1>
              <p>Your email has been successfully verified. You can now return to your original browser tab to complete your setup.</p>
            </div>
          </body>
        </html>
      `);
    } catch (err: any) {
      res.setHeader('Content-Type', 'text/html');
      res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Verification Failed</title>
            <style>
              body {
                background-color: #000;
                color: #fff;
                font-family: system-ui, -apple-system, sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
              }
              .card {
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.1);
                padding: 2.5rem;
                border-radius: 1.5rem;
                text-align: center;
                max-width: 400px;
              }
              h1 { color: #f87171; margin-bottom: 0.5rem; }
              p { color: #9ca3af; font-size: 0.95rem; line-height: 1.5; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Verification Failed</h1>
              <p>${err.message || 'The verification link is invalid or has expired.'}</p>
            </div>
          </body>
        </html>
      `);
    }
  }

  @Get('verify-status')
  async verifyStatus(@Query('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('UserId is required');
    }
    return this.authService.getVerificationStatus(userId);
  }

  @Post('google')
  async google(@Body() body: { token: string }) {
    if (!body.token) {
      throw new UnauthorizedException('Google ID token is required');
    }
    return this.authService.googleLogin(body.token);
  }

  @Post('firebase')
  async firebase(@Body() body: { token: string }) {
    if (!body.token) {
      throw new UnauthorizedException('Firebase ID token is required');
    }
    return this.authService.firebaseLogin(body.token);
  }

  @UseGuards(AuthGuard)
  @Post('add-phone')
  async requestPhoneAdd(@Request() req: any, @Body() body: { phone: string }) {
    if (!body.phone) throw new UnauthorizedException('Phone number required');
    return this.authService.requestPhoneAdd(req.user.sub, body.phone);
  }

  @UseGuards(AuthGuard)
  @Post('verify-add-phone')
  async verifyPhoneAdd(
    @Request() req: any,
    @Body() body: { phone: string; code: string },
  ) {
    if (!body.phone || !body.code)
      throw new UnauthorizedException('Phone and code required');
    return this.authService.verifyPhoneAdd(req.user.sub, body.phone, body.code);
  }

  /** Resend OTP to phone/email after expiry */
  @Post('resend-otp')
  async resendOtp(@Body() body: { userId: string }) {
    if (!body.userId) throw new UnauthorizedException('userId is required');
    return this.authService.resendOtp(body.userId);
  }

  @UseGuards(AuthGuard)
  @Post('tutorial-seen')
  async markTutorialSeen(@Request() req: any) {
    return this.authService.markTutorialSeen(req.user.sub as string);
  }

  @UseGuards(AuthGuard)
  @Get('me')
  async getProfile(@Request() req: any) {
    const user = await this.usersService.findById(req.user.sub as string);
    if (!user) throw new UnauthorizedException();
    // omit password
    const { password_hash, ...result } = user;
    return result;
  }

  @UseGuards(AuthGuard)
  @Post('bootstrap-admin')
  async bootstrapAdmin(@Request() req: any, @Body() body: { passkey: string }) {
    if (!body.passkey) throw new BadRequestException('Passkey is required');
    return this.authService.bootstrapAdmin(
      req.user.sub as string,
      body.passkey,
    );
  }

  @Post('totp/setup')
  async setupTotp(@Body() body: { email: string }) {
    if (!body.email) throw new BadRequestException('Email is required');
    return this.authService.setupTotp(body.email);
  }

  @Post('totp/verify-setup')
  async verifyTotpSetup(@Body() body: { email: string; code: string }) {
    if (!body.email || !body.code) throw new BadRequestException('Email and code are required');
    return this.authService.verifyTotpSetup(body.email, body.code);
  }

  @Post('totp/login')
  async totpLogin(@Body() body: { email: string; code: string }) {
    if (!body.email || !body.code) throw new BadRequestException('Email and code are required');
    return this.authService.totpLogin(body.email, body.code);
  }

  // ---------------------------------------------------------------
  // COMPOSIO — Per-user Gmail Connection
  // ---------------------------------------------------------------

  /**
   * Returns the Gmail OAuth URL that the user must visit once to connect
   * their Gmail account to Composio. After authorization, their workflow
   * email nodes will send from their own Gmail.
   */
  @UseGuards(AuthGuard)
  @Get('composio/connect-url')
  async composioConnectUrl(@Request() req: any) {
    const user = await this.usersService.findById(req.user.sub as string);
    if (!user?.email) throw new BadRequestException('User has no email address');
    const url = await this.composioService.getGmailConnectionUrl(user.email);
    if (!url) {
      throw new BadRequestException('Could not generate Composio connection URL. Check COMPOSIO_API_KEY.');
    }
    return { url };
  }

  /**
   * Returns whether the user has connected their Gmail account to Composio.
   * The UI uses this to show a "Connect Gmail" prompt when a Gmail node is used.
   */
  @UseGuards(AuthGuard)
  @Get('composio/status')
  async composioStatus(@Request() req: any) {
    const user = await this.usersService.findById(req.user.sub as string);
    if (!user?.email) return { connected: false };
    const connected = await this.composioService.isGmailConnected(user.email);
    return { connected, entityId: user.email };
  }
}
