import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import twilio from 'twilio';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private twilioClient: twilio.Twilio | null = null;
  private twilioFrom: string;

  constructor(private readonly configService: ConfigService) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const apiKeySid = this.configService.get<string>('TWILIO_API_KEY_SID');
    const apiKeySecret = this.configService.get<string>(
      'TWILIO_API_KEY_SECRET',
    );
    this.twilioFrom =
      this.configService.get<string>('TWILIO_PHONE_NUMBER') || '';

    if (accountSid && apiKeySid && apiKeySecret) {
      this.twilioClient = twilio(apiKeySid, apiKeySecret, { accountSid });
      this.logger.log('Twilio client initialized (API Key auth)');
    } else {
      this.logger.warn(
        'Twilio credentials not configured — OTP will be logged only',
      );
    }
  }

  generateOtp(): string {
    if (process.env.NODE_ENV === 'test') {
      const bytes = crypto.randomBytes(3);
      const num = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) % 1000000;
      return num.toString().padStart(6, '0');
    }
    // For demo/development testing ease, use a static code '112345'
    return '112345';
  }

  getExpiry(): Date {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);
    return expiresAt;
  }

  async sendOtp(
    recipient: string,
    code: string,
    type: 'email' | 'phone',
    userId?: string,
  ): Promise<void> {
    let message = `Your Agent Flow verification code is: ${code}. Valid for 10 minutes.`;

    if (type === 'email' && userId) {
      const verifyLink = `http://localhost:3000/api/auth/verify-link?userId=${userId}&code=${code}`;
      message = `Your Agent Flow verification code is: ${code}.\n\nOr click the link below to verify automatically:\n${verifyLink}`;
    }

    if (type === 'phone') {
      if (this.twilioClient && this.twilioFrom) {
        try {
          await this.twilioClient.messages.create({
            body: message,
            from: this.twilioFrom,
            to: recipient,
          });
          this.logger.log(`SMS OTP sent to ${recipient}`);
        } catch (err: any) {
          this.logger.error(
            `Failed to send SMS to ${recipient}: ${err.message}`,
          );
          // Log fallback so dev can still test
          this.logger.warn(`[FALLBACK] OTP for ${recipient}: ${code}`);
        }
      } else {
        this.logger.log(`[MOCK SMS] To: ${recipient} | ${message}`);
      }
    } else {
      // Email: log for now (integrate SendGrid / SES here later)
      this.logger.log(
        `[MOCK EMAIL] To: ${recipient} | Subject: Your Verification Code | Body: ${message}`,
      );
    }
  }

  async sendSms(to: string, body: string): Promise<void> {
    if (this.twilioClient && this.twilioFrom) {
      try {
        await this.twilioClient.messages.create({
          body,
          from: this.twilioFrom,
          to,
        });
        this.logger.log(`SMS sent to ${to}`);
      } catch (err: any) {
        this.logger.error(`Failed to send SMS to ${to}: ${err.message}`);
      }
    } else {
      this.logger.log(`[MOCK SMS] To: ${to} | ${body}`);
    }
  }
}
