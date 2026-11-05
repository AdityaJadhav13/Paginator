/** A new paper's sign-up (/signup) and its Owner's first screen (/onboarding): English strings, spread into en.ts.
 * Error codes they add go here too, as "error.<code>". */
export const PAPER_SIGNUP_EN = {
  "error.signup_limit": "Too many sign-ups from here. Try again later.",
  "paperSignup.formTitle": "Sign up a new paper",
  "paperSignup.lede":
    "Is your newspaper new to Pageinator? Tell us about it. A person at Pageinator checks each request, then sets up your paper and makes you its owner.",
  "paperSignup.paperName": "Newspaper's name",
  "paperSignup.paperNameMissing": "Enter the newspaper's name.",
  "paperSignup.ownerName": "Your name",
  "paperSignup.ownerNameHint": "You become the paper's owner, and you invite everyone else.",
  "paperSignup.email": "Your email address",
  "paperSignup.language": "The paper's language",
  "paperSignup.trap": "Leave this empty",
  "paperSignup.submit": "Send request",
  "paperSignup.sending": "Sending…",
  "paperSignup.invalid": "Some details need fixing.",
  "paperSignup.sent.heading": "Check your email",
  "paperSignup.sent.body":
    "A link to confirm your email address is on its way. Open it within 24 hours. If nothing comes, look in the spam folder.",
  "paperSignup.busy.heading": "Too many requests from here",
  "paperSignup.busy.body": "Try again in an hour.",
  "paperSignup.failed.heading": "The request was not sent",
  "paperSignup.failed.body": "Check your connection and try again.",
  "paperSignup.joining.title": "Joining a paper that already uses Pageinator?",
  "paperSignup.confirming": "Confirming your email address…",
  "paperSignup.waiting.heading": "Your email address is confirmed",
  "paperSignup.waiting.body":
    "Your request is waiting for approval. A person at Pageinator checks each new paper. When your paper is ready, you get an email that says how to sign in.",
  "paperSignup.badLink.heading": "This link does not work",
  "paperSignup.badLink.body":
    "It may be more than 24 hours old, or it was used already. Send the form again to get a new link.",
  "paperSignup.confirmFailed.body": "Your email address could not be confirmed just now. Check your connection and open the link again.",
  "paperOnboarding.title": "Welcome to Pageinator",
  "paperOnboarding.lede": "Your paper is set up. Check its details, then set up its design.",
  "paperOnboarding.loading": "Loading your paper…",
  "paperOnboarding.signedOut": "Sign in to set up your paper.",
  "paperOnboarding.noPaper.heading": "You do not own a paper here yet",
  "paperOnboarding.noPaper.body":
    "This page is for the owner of a new paper. If your paper's request was approved, sign in with the email address you gave.",
  "paperOnboarding.retry": "Try again",
  "paperOnboarding.step1": "Step 1: Check your paper's details",
  "paperOnboarding.name": "Name",
  "paperOnboarding.languages": "Languages",
  "paperOnboarding.primary": "Main language",
  "paperOnboarding.changeName": "Change the name",
  "paperOnboarding.languagesNote": "To change the languages, write to us from the contact page.",
  "paperOnboarding.step2": "Step 2: Set up your paper's design",
  "paperOnboarding.step2Body":
    "Pageinator learns your paper's page design from a few of its past editions. Then it lays out new editions the same way.",
  "paperOnboarding.design": "Set up your paper's design",
  "paperOnboarding.later": "Do this later and open the workspace",
} as const;
