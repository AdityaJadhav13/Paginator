/**
 * English / मराठी (03 §5.1: the language toggle on top of the sign-in screens). Two toggle buttons, each written in
 * its own language and marked with its `lang`, so a screen reader says "मराठी" in Marathi whatever the page language.
 */
import { useId } from "react";
import { Button, Cluster, VisuallyHidden } from "../ui/index.ts";
import { LANGUAGES, LANGUAGE_NAMES } from "./catalogue.ts";
import { useI18n } from "./I18nProvider.tsx";

export function LanguageSwitch() {
  const { language, setLanguage, t } = useI18n();
  const labelId = useId();
  return (
    <Cluster gap="2" role="group" aria-labelledby={labelId} className="pg-language-switch">
      <VisuallyHidden id={labelId}>{t("language.label")}</VisuallyHidden>
      {LANGUAGES.map((code) => (
        <Button
          key={code}
          variant={code === language ? "secondary" : "quiet"}
          size="sm"
          lang={code}
          aria-pressed={code === language}
          onClick={() => setLanguage(code)}
        >
          {LANGUAGE_NAMES[code]}
        </Button>
      ))}
    </Cluster>
  );
}
