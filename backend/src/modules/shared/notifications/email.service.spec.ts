import nodemailer from 'nodemailer';
import { EmailService } from './email.service';

const mockTransports: Array<{ sendMail: jest.Mock }> = [];

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(() => {
      const transport = { sendMail: jest.fn() };
      mockTransports.push(transport);
      return transport;
    }),
  },
}));

function config(values: Record<string, string>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as any;
}

describe('EmailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransports.length = 0;
  });

  it('uses SMTP without auth when MAIL_AUTH is false, even if a password exists', () => {
    new EmailService(
      config({
        EMAIL_MODE: 'prod',
        MAIL_HOST: 'smtp-relay.gmail.com',
        MAIL_PORT: '587',
        MAIL_USER: 'legacy-user',
        MAIL_PASS: 'legacy-password',
        MAIL_AUTH: 'false',
        MAIL_FROM: 'Conges <conges@upowa.org>',
      }),
    );

    expect(nodemailer.createTransport).toHaveBeenNthCalledWith(1, {
      host: 'smtp-relay.gmail.com',
      name: 'upowa.org',
      port: 587,
      secure: false,
    });
    expect(nodemailer.createTransport).toHaveBeenNthCalledWith(2, {
      direct: true,
      name: 'upowa.org',
    });
  });

  it('falls back to direct delivery when no SMTP server is configured', () => {
    new EmailService(
      config({
        EMAIL_MODE: 'prod',
        MAIL_FROM: 'Conges <conges@upowa.org>',
      }),
    );

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      direct: true,
      name: 'upowa.org',
    });
  });

  it('tries direct delivery when the SMTP relay closes the EHLO connection', async () => {
    const service = new EmailService(
      config({
        EMAIL_MODE: 'prod',
        MAIL_HOST: 'smtp-relay.gmail.com',
        MAIL_PORT: '465',
        MAIL_AUTH: 'false',
        MAIL_FROM: 'Conges <conges@upowa.org>',
      }),
    );

    const smtpError = Object.assign(new Error('Server terminates connection'), {
      command: 'EHLO',
      response: '421 4.7.0 Try again later, closing connection. (EHLO)',
      responseCode: 421,
    });
    mockTransports[0].sendMail.mockRejectedValueOnce(smtpError);
    mockTransports[1].sendMail.mockResolvedValueOnce({
      accepted: ['n1@upowa.org'],
    });

    await service.send({
      to: 'n1@upowa.org',
      subject: 'Demande validee par votre manager',
      text: 'Votre demande a ete traitee.',
    });

    expect(mockTransports[0].sendMail).toHaveBeenCalledTimes(1);
    expect(mockTransports[1].sendMail).toHaveBeenCalledTimes(1);
  });
});
