import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  Get,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
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
