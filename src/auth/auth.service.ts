import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { OtpService } from './otp.service';
import { FirebaseService } from './firebase.service';
import { OAuth2Client } from 'google-auth-library';
import { CreditsService } from '../credits/credits.service';
import { TotpService } from './totp.service';
import { ComposioService } from '../composio/composio.service';

@Injectable()
export class AuthService {
  private googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  private readonly STARTER_CREDITS = 50;
  private verifiedSessions = new Map<string, { access_token: string; user: any }>();

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private otpService: OtpService,
    private firebaseService: FirebaseService,
    private totpService: TotpService,
    private composioService: ComposioService,
    @Inject(forwardRef(() => CreditsService))
    private creditsService: CreditsService,
  ) {}

  async firebaseLogin(token: string) {
    try {
      const decodedToken = await this.firebaseService.verifyIdToken(token);
      const { uid, email, phone_number } = decodedToken;

      let user = await this.usersService.findBySsoId(uid);

      if (!user) {
        // Try finding by email or phone if uid doesn't match
        if (email) {
          user = await this.usersService.findByEmail(email);
        } else if (phone_number) {
          user = await this.usersService.findByPhone(phone_number);
        }

        if (user) {
          // Link uid to existing user
          await this.usersService.update(user.id, { sso_id: uid });
        } else {
          // Create new user
          user = await this.usersService.create({
            sso_id: uid,
            email: email,
            phone_number: phone_number,
            is_email_verified: !!email,
            is_phone_verified: !!phone_number,
            credits: this.STARTER_CREDITS,
          });
          // Register Composio entity so workflow email actions use their account
          if (email) {
            await this.composioService.registerEntity(email);
          }
        }
      }

      return this.login(user);
    } catch (e) {
      throw new UnauthorizedException('Invalid Firebase Token');
    }
  }

  async validateUser(email: string, pass: string): Promise<User | null> {
    const user = await this.usersService.findByEmail(email);
    if (user && user.password_hash) {
      const isMatch = await bcrypt.compare(pass, user.password_hash);
      if (isMatch) {
        return user;
      }
    }
    return null;
  }

  private async checkAdminPromotion(user: User): Promise<User> {
    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase());
    if (
      user.email &&
      adminEmails.includes(user.email.toLowerCase()) &&
      !user.is_admin
    ) {
      console.log(
        `Auto-promoting ${user.email} to Admin based on ADMIN_EMAILS config.`,
      );
      await this.usersService.update(user.id, { is_admin: true });
      return (await this.usersService.findById(user.id)) || user;
    }
    return user;
  }

  async login(user: User) {
    const promotedUser = await this.checkAdminPromotion(user);
    const payload = {
      email: promotedUser.email,
      sub: promotedUser.id,
      is_admin: promotedUser.is_admin,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: promotedUser.id,
        email: promotedUser.email,
        phone_number: promotedUser.phone_number,
        credits: promotedUser.credits,
        sso_id: promotedUser.sso_id,
        is_admin: promotedUser.is_admin,
      },
    };
  }

  async register(data: {
    email?: string;
    password?: string;
    phone_number?: string;
    sso_id?: string;
  }) {
    if (data.email) {
      const existing = await this.usersService.findByEmail(data.email);
      if (existing) throw new BadRequestException('Email already in use');
    }
    if (data.phone_number) {
      const existing = await this.usersService.findByPhone(data.phone_number);
      if (existing)
        throw new BadRequestException('Phone number already in use');
    }

    const userData: Partial<User> = {
      email: data.email,
      phone_number: data.phone_number,
      sso_id: data.sso_id,
    };

    if (data.password) {
      userData.password_hash = await bcrypt.hash(data.password, 10);
    }

    // Give new users starter credits so the app is usable immediately.
    // (We still grant an additional bonus for phone verification later.)
    userData.credits = this.STARTER_CREDITS;
    const newUser = await this.usersService.create(userData);

    // Register a Composio entity for the user so their email workflows can
    // send via their own connected Gmail account (lazy OAuth — they connect later).
    if (data.email) {
      await this.composioService.registerEntity(data.email);
    }
    // Generate and "send" OTP
    const otp = this.otpService.generateOtp();
    const expiresAt = this.otpService.getExpiry();
    await this.usersService.update(newUser.id, {
      otp_code: otp,
      otp_expires_at: expiresAt,
    });

    if (data.phone_number) {
      await this.otpService.sendOtp(data.phone_number, otp, 'phone');
    } else if (data.email) {
      await this.otpService.sendOtp(data.email, otp, 'email', newUser.id);
    }

    return { message: 'OTP sent for verification', userId: newUser.id };
  }

  async verifyOtp(userId: string, code: string, saveSession = false) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new BadRequestException('User not found');
    if (!user.otp_code || user.otp_code !== code) {
      throw new BadRequestException('Invalid OTP');
    }
    if (!user.otp_expires_at || user.otp_expires_at < new Date()) {
      throw new BadRequestException('OTP expired');
    }

    // Mark as verified
    const isPhone = !!user.phone_number;

    await this.usersService.update(user.id, {
      otp_code: null,
      otp_expires_at: null,
      is_phone_verified: isPhone ? true : user.is_phone_verified,
      is_email_verified: !isPhone && user.email ? true : user.is_email_verified,
    });

    // Bonus credits for phone verification (anti-spam + higher trust)
    if (isPhone && !user.is_phone_verified) {
      await this.creditsService.grant(
        user.id,
        5000,
        'Phone Verification Bonus',
      );
    }
    // Ensure email-only users still have some usable balance even if an older
    // record was created with 0 credits.
    if (!isPhone && user.email && user.credits <= 0) {
      await this.creditsService.grant(
        user.id,
        this.STARTER_CREDITS,
        'Email Verification Starter Credits',
      );
    }

    const updatedUser = (await this.usersService.findById(user.id)) as User;
    const session = await this.login(updatedUser);
    if (saveSession) {
      this.verifiedSessions.set(userId, session);
    }
    return session;
  }

  async resendOtp(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new BadRequestException('User not found');

    const otp = this.otpService.generateOtp();
    const expiresAt = this.otpService.getExpiry();
    await this.usersService.update(user.id, {
      otp_code: otp,
      otp_expires_at: expiresAt,
    });

    if (user.phone_number) {
      await this.otpService.sendOtp(user.phone_number, otp, 'phone');
    } else if (user.email) {
      await this.otpService.sendOtp(user.email, otp, 'email', user.id);
    }

    return { message: 'OTP resent successfully' };
  }

  getVerificationStatus(userId: string) {
    const session = this.verifiedSessions.get(userId);
    if (session) {
      this.verifiedSessions.delete(userId);
      return { verified: true, ...session };
    }
    return { verified: false };
  }

  async markTutorialSeen(userId: string) {
    await this.usersService.update(userId, { has_seen_tutorial: true });
    return { success: true };
  }

  async ssoLogin(sso_id: string, email: string) {
    let user = await this.usersService.findBySsoId(sso_id);
    if (!user) {
      // Create user if not exists
      user = await this.usersService.create({ sso_id, email });
    }
    return this.login(user);
  }

  async googleLogin(token: string) {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email) {
        throw new BadRequestException('Invalid Google Token structure');
      }
      return this.ssoLogin(payload.sub, payload.email);
    } catch (e) {
      throw new UnauthorizedException('Invalid Google Token');
    }
  }

  async requestPhoneAdd(userId: string, phone_number: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new BadRequestException('User not found');
    if (user.phone_number)
      throw new BadRequestException('Phone already exists');

    const otp = this.otpService.generateOtp();
    const expiresAt = this.otpService.getExpiry();
    await this.usersService.update(user.id, {
      otp_code: otp,
      otp_expires_at: expiresAt,
    });
    await this.otpService.sendOtp(phone_number, otp, 'phone');

    return { message: 'OTP sent to mobile device' };
  }

  async verifyPhoneAdd(userId: string, phone_number: string, code: string) {
    const user = await this.usersService.findById(userId);
    if (
      !user ||
      user.otp_code !== code ||
      (user.otp_expires_at && user.otp_expires_at < new Date())
    ) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    await this.usersService.update(user.id, {
      otp_code: null,
      otp_expires_at: null,
      phone_number,
      is_phone_verified: true,
    });

    await this.creditsService.grant(user.id, 5000, 'Phone Verification Bonus');

    const updatedUser = (await this.usersService.findById(user.id)) as User;
    return this.login(updatedUser); // Return a fresh token to reflect any new payload states if needed
  }

  async bootstrapAdmin(userId: string, passkey: string) {
    const secretKey = process.env.SUPER_ADMIN_PASSKEY;
    if (!secretKey) {
      throw new BadRequestException('Super admin passkey is not configured in the environment');
    }
    if (passkey !== secretKey) {
      throw new UnauthorizedException('Invalid super admin passkey');
    }

    await this.usersService.update(userId, { is_admin: true });
    const user = await this.usersService.findById(userId);
    if (!user) throw new BadRequestException('User not found');

    return this.login(user);
  }

  async setupTotp(email: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new BadRequestException('User not found');

    if (user.is_totp_enabled) {
      throw new BadRequestException('Authenticator is already set up for this email');
    }

    const { secret, qrCodeUrl } = await this.totpService.generateSecret(email);
    await this.usersService.update(user.id, { totp_secret: secret });

    return { qrCodeUrl };
  }

  async verifyTotpSetup(email: string, token: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.totp_secret) throw new BadRequestException('TOTP not initiated for user');

    const isValid = this.totpService.verifyToken(user.totp_secret, token);
    if (!isValid) throw new UnauthorizedException('Invalid TOTP code');

    await this.usersService.update(user.id, { is_totp_enabled: true });
    return { success: true };
  }

  async totpLogin(email: string, token: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.is_totp_enabled || !user.totp_secret) {
      throw new UnauthorizedException('TOTP not enabled or invalid user');
    }

    const isValid = this.totpService.verifyToken(user.totp_secret, token);
    if (!isValid) throw new UnauthorizedException('Invalid TOTP code');

    return this.login(user);
  }
}
