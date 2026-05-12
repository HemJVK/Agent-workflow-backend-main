import { Test, TestingModule } from '@nestjs/testing';
import { CreditsService } from './credits.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { CreditTransaction } from './entities/credit-transaction.entity';
import { BadRequestException } from '@nestjs/common';
import { OtpService } from '../auth/otp.service';
import { ConfigService } from '@nestjs/config';

describe('CreditsService', () => {
  let service: CreditsService;
  let userRepository: any;
  let transactionRepository: any;

  const fakeUser = {
    id: 'user-1',
    credits: 100,
    save: async () => fakeUser,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditsService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            updateCalled: false,
            findOne: async () => fakeUser,
            save: async () => fakeUser,
            update: async function() { this.updateCalled = true; return {}; },
          },
        },
        {
          provide: getRepositoryToken(CreditTransaction),
          useValue: {
            saveCalled: false,
            create: () => ({}),
            save: async function() { this.saveCalled = true; return {}; },
          },
        },
        {
          provide: OtpService,
          useValue: {
            sendSms: async () => ({}),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: () => 'dummy',
          },
        },
      ],
    }).compile();

    service = module.get<CreditsService>(CreditsService);
    userRepository = module.get(getRepositoryToken(User));
    transactionRepository = module.get(getRepositoryToken(CreditTransaction));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('deduct', () => {
    it('should deduct credits if balance is sufficient', async () => {
      fakeUser.credits = 100;
      const remaining = await service.deduct('user-1', 'HELPER_CHAT');
      
      expect(remaining).toBe(99);
      expect(userRepository.updateCalled).toBe(true);
      expect(transactionRepository.saveCalled).toBe(true);
    });

    it('should throw BadRequestException if balance is insufficient', async () => {
      fakeUser.credits = 0;
      await expect(service.deduct('user-1', 'HELPER_CHAT')).rejects.toThrow(BadRequestException);
    });
  });

  describe('topUp', () => {
    it('should increase user credits', async () => {
      fakeUser.credits = 100;
      const updated = await service.topUp('user-1', 50);
      
      expect(updated).toBe(150);
      expect(userRepository.updateCalled).toBe(true);
    });
  });
});
