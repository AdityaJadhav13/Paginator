/** Sign-in's Marathi strings (spread into mr.ts): a first draft for the native reviewer (review.ts, D-5). */
import type { AUTH_EN } from "./auth.en.ts";

export const AUTH_MR: Readonly<Record<keyof typeof AUTH_EN, string>> = {
  "signedIn.invitations.heading": "तुमची निमंत्रणे",
  "signedIn.invitations.loading": "तुमची निमंत्रणे शोधत आहे…",
  "problem.slowDown.waitSeconds": "{count} सेकंद थांबा आणि पुन्हा प्रयत्न करा.",
  "problem.slowDown.waitMinutes": "{count} मिनिटे थांबा आणि पुन्हा प्रयत्न करा.",
};
