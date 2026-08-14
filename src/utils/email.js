const nodemailer = require("nodemailer");

const env = require("../config/env");
const logger = require("../config/logger");

let cachedTransport;


const getTransport = () => {
  if (cachedTransport !== undefined) return cachedTransport;

  if (!env.SMTP_HOST) {
    cachedTransport = null;
    return cachedTransport;
  }

  cachedTransport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined,
  });

  return cachedTransport;
};

const sendMail = async ({ to, subject, text, html }) => {
  const transport = getTransport();

  if (!transport) {
    logger.warn("SMTP not configured — printing the email instead of sending", {
      to,
      subject,
      body: text,
    });
    return { delivered: false, reason: "smtp-not-configured" };
  }

  const info = await transport.sendMail({
    from: env.MAIL_FROM,
    to,
    subject,
    text,
    html,
  });

  logger.info("verification email sent", { to, messageId: info.messageId });
  return { delivered: true, messageId: info.messageId };
};

const sendVerificationEmail = ({ to, name, url, expiresInMinutes }) =>
  sendMail({
    to,
    subject: "Confirm your email address",
    text: `Hi ${name},\n\nConfirm your email address by opening this link:\n${url}\n\nThe link expires in ${expiresInMinutes} minutes. If you did not create this account you can ignore this message.`,
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
        <h2 style="margin:0 0 16px">Hi ${name},</h2>
        <p>Confirm your email address to finish setting up your account. This link expires in ${expiresInMinutes} minutes.</p>
        <p style="margin:24px 0">
          <a href="${url}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Confirm email</a>
        </p>
        <p style="font-size:13px;color:#666">If the button does not work, paste this into your browser:<br>${url}</p>
        <p style="font-size:13px;color:#666">If you did not create this account, you can ignore this email.</p>
      </div>
    `,
  });

const sendPasswordResetEmail = ({ to, name, url, expiresInMinutes }) =>
  sendMail({
    to,
    subject: "Reset your password",
    text: `Hi ${name},\n\nReset your password using this link:\n${url}\n\nThe link expires in ${expiresInMinutes} minutes. If you did not ask for this, ignore this message and your password stays unchanged.`,
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
        <h2 style="margin:0 0 16px">Hi ${name},</h2>
        <p>Use the button below to choose a new password. This link expires in ${expiresInMinutes} minutes and can only be used once.</p>
        <p style="margin:24px 0">
          <a href="${url}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Reset password</a>
        </p>
        <p style="font-size:13px;color:#666">If the button does not work, paste this into your browser:<br>${url}</p>
        <p style="font-size:13px;color:#666">If you did not ask for this, ignore this email — your password stays unchanged.</p>
      </div>
    `,
  });

module.exports = { sendMail, sendVerificationEmail, sendPasswordResetEmail };
