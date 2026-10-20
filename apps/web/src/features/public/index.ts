/**
 * UI005 public feature export surface.
 *
 * Only the five route leaves are exported; the shared pieces (PrimaryCta,
 * StandingHead, CapabilityNote, PageGeometryFigure, ClosingBand, TodayList)
 * are internal to this feature. Importing the stylesheet here means the
 * public styles load with the feature rather than from durable shell code.
 */
import "./public.css";

export { HomePage } from "./HomePage.tsx";
export { FeaturesPage } from "./FeaturesPage.tsx";
export { PricingPage } from "./PricingPage.tsx";
export { SecurityPage } from "./SecurityPage.tsx";
export { ContactPage } from "./ContactPage.tsx";
