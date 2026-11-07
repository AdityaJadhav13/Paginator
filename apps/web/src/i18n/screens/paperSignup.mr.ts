/** A new paper's sign-up and its Owner's first screen: Marathi strings (spread into mr.ts), a first draft for the native
 * reviewer (review.ts). */
import type { PAPER_SIGNUP_EN } from "./paperSignup.en.ts";

export const PAPER_SIGNUP_MR: Readonly<Record<keyof typeof PAPER_SIGNUP_EN, string>> = {
  "error.signup_limit": "इथून खूप नोंदण्या आल्या आहेत. नंतर पुन्हा प्रयत्न करा.",
  "paperSignup.formTitle": "नवीन वृत्तपत्राची नोंदणी करा",
  "paperSignup.lede":
    "तुमचे वृत्तपत्र Pageinator वर नवीन आहे का? त्याची माहिती द्या. Pageinator मधील एक व्यक्ती प्रत्येक विनंती तपासते, मग तुमचे वृत्तपत्र सुरू करते आणि तुम्हाला त्याचे मालक बनवते.",
  "paperSignup.paperName": "वृत्तपत्राचे नाव",
  "paperSignup.paperNameMissing": "वृत्तपत्राचे नाव लिहा.",
  "paperSignup.ownerName": "तुमचे नाव",
  "paperSignup.ownerNameHint": "तुम्ही वृत्तपत्राचे मालक व्हाल, आणि बाकी सर्वांना तुम्ही निमंत्रण पाठवाल.",
  "paperSignup.email": "तुमचा ईमेल पत्ता",
  "paperSignup.language": "वृत्तपत्राची भाषा",
  "paperSignup.trap": "हे रिकामे ठेवा",
  "paperSignup.submit": "विनंती पाठवा",
  "paperSignup.sending": "पाठवत आहे…",
  "paperSignup.invalid": "काही माहिती दुरुस्त करायला हवी.",
  "paperSignup.sent.heading": "तुमचा ईमेल पाहा",
  "paperSignup.sent.body":
    "तुमचा ईमेल पत्ता निश्चित करण्याचा दुवा येत आहे. तो 24 तासांत उघडा. काही आले नाही, तर स्पॅम फोल्डर पाहा.",
  "paperSignup.busy.heading": "इथून खूप विनंत्या आल्या आहेत",
  "paperSignup.busy.body": "एका तासाने पुन्हा प्रयत्न करा.",
  "paperSignup.failed.heading": "विनंती पाठवली गेली नाही",
  "paperSignup.failed.body": "तुमचे इंटरनेट कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.",
  "paperSignup.joining.title": "Pageinator आधीच वापरणाऱ्या वृत्तपत्रात सामील होत आहात?",
  "paperSignup.confirming": "तुमचा ईमेल पत्ता निश्चित करत आहे…",
  "paperSignup.waiting.heading": "तुमचा ईमेल पत्ता निश्चित झाला",
  "paperSignup.waiting.body":
    "तुमची विनंती मंजुरीची वाट पाहत आहे. Pageinator मधील एक व्यक्ती प्रत्येक नवीन वृत्तपत्र तपासते. तुमचे वृत्तपत्र तयार झाले की साइन इन कसे करायचे ते सांगणारा ईमेल तुम्हाला येईल.",
  "paperSignup.badLink.heading": "हा दुवा चालत नाही",
  "paperSignup.badLink.body":
    "तो 24 तासांपेक्षा जुना असेल, किंवा आधीच वापरला गेला असेल. नवीन दुव्यासाठी फॉर्म पुन्हा पाठवा.",
  "paperSignup.confirmFailed.body":
    "तुमचा ईमेल पत्ता आत्ता निश्चित होऊ शकला नाही. तुमचे इंटरनेट कनेक्शन तपासा आणि दुवा पुन्हा उघडा.",
  "paperOnboarding.title": "Pageinator मध्ये स्वागत आहे",
  "paperOnboarding.lede": "तुमचे वृत्तपत्र सुरू झाले आहे. त्याची माहिती तपासा, मग त्याची रचना तयार करा.",
  "paperOnboarding.loading": "तुमचे वृत्तपत्र उघडत आहे…",
  "paperOnboarding.signedOut": "तुमचे वृत्तपत्र तयार करण्यासाठी साइन इन करा.",
  "paperOnboarding.noPaper.heading": "इथे अजून तुमच्या मालकीचे वृत्तपत्र नाही",
  "paperOnboarding.noPaper.body":
    "हे पान नवीन वृत्तपत्राच्या मालकासाठी आहे. तुमच्या वृत्तपत्राची विनंती मंजूर झाली असेल, तर दिलेल्या ईमेल पत्त्याने साइन इन करा.",
  "paperOnboarding.retry": "पुन्हा प्रयत्न करा",
  "paperOnboarding.step1": "पायरी 1: तुमच्या वृत्तपत्राची माहिती तपासा",
  "paperOnboarding.name": "नाव",
  "paperOnboarding.languages": "भाषा",
  "paperOnboarding.primary": "मुख्य भाषा",
  "paperOnboarding.changeName": "नाव बदला",
  "paperOnboarding.languagesNote": "भाषा बदलायच्या असतील, तर संपर्क पानावरून आम्हाला लिहा.",
  "paperOnboarding.step2": "पायरी 2: तुमच्या वृत्तपत्राची रचना तयार करा",
  "paperOnboarding.step2Body":
    "Pageinator तुमच्या वृत्तपत्राच्या काही जुन्या अंकांवरून त्याची पानरचना शिकते. मग नवीन अंक त्याच पद्धतीने मांडते.",
  "paperOnboarding.design": "तुमच्या वृत्तपत्राची रचना तयार करा",
  "paperOnboarding.later": "हे नंतर करा आणि कार्यक्षेत्र उघडा",
};
