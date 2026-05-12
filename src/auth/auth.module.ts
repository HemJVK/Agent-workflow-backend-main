import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { OtpService } from './otp.service';
import { FirebaseService } from './firebase.service';
import { TotpService } from './totp.service';
import { CreditsModule } from '../credits/credits.module';
import { ComposioModule } from '../composio/composio.module';

@Module({
  imports: [
    forwardRef(() => CreditsModule),
    forwardRef(() => UsersModule),
    ComposioModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret:
          configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, FirebaseService, TotpService],
  exports: [AuthService, JwtModule, OtpService, FirebaseService, TotpService],
})
export class AuthModule {}
