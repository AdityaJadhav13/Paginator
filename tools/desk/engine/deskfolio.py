"""Running heads and folios of a template page, rewritten for the new edition: weekday, date, page number, number of
pages, and (when given) volume, issue and price. Only these words change; every other word of the furniture stays as
the paper prints it. Pure text functions (no fonts), so they are easy to test.
"""
from __future__ import annotations

import re
from datetime import date

WEEKDAYS = ("सोमवार", "मंगळवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार", "रविवार")       # Monday first (date.weekday())
MONTHS = ("जानेवारी", "फेब्रुवारी", "मार्च", "एप्रिल", "मे", "जून", "जुलै", "ऑगस्ट", "सप्टेंबर", "ऑक्टोबर", "नोव्हेंबर",
          "डिसेंबर")
DEVA_DIGITS = "०१२३४५६७८९"
_NUM = r"[0-9०-९]+"
_LETTER = "[ऀ-ॣॱ-ॿ]"        # a Devanagari letter or sign (not a digit or danda): a word goes on
_MONTH = f"(?<!{_LETTER})(?:" + "|".join(sorted(MONTHS, key=len, reverse=True)) + f")(?!{_LETTER})"
_WEEKDAY = f"(?<!{_LETTER})(?:" + "|".join(WEEKDAYS) + f")(?!{_LETTER})"


EN_WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
EN_MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
             "November", "December")
_EN_MONTH = r"\b(?:" + "|".join(EN_MONTHS) + r")\b"
_EN_WEEKDAY = r"\b(?:" + "|".join(EN_WEEKDAYS) + r")\b"
ENGLISH = False                 # a Latin-script paper's running head (deskprofile.use_dataset sets it; never the pilot's)


def digits_like(sample: str, n: int | str) -> str:
    """n written in the digits the sample uses (Devanagari if the sample has any)."""
    s = str(n)
    if any(ch in DEVA_DIGITS for ch in sample):
        return "".join(DEVA_DIGITS[int(ch)] if ch.isdigit() else ch for ch in s)
    return s


def _num(sample: str, value) -> str:
    return digits_like(sample, value)


def rewrite(text: str, day: date, page: int, pages: int, volume: str = "", issue: str = "", price: str = "") -> str:
    """The furniture text with the edition's own date and numbers. Unknown words are left alone."""
    t = text
    t = re.sub(_WEEKDAY, WEEKDAYS[day.weekday()], t)
    month = MONTHS[day.month - 1]
    # "१२ नोव्हेंबर २०२५" / "१२ नोव्हेंबर, २०२५" / "नोव्हेंबर २०२५"
    t = re.sub(rf"({_NUM})(\s*){_MONTH}", lambda m: f"{_num(m.group(1), day.day)}{m.group(2)}{month}", t)
    t = re.sub(rf"{_MONTH}(,?\s*)([0-9०-९]{{4}})", lambda m: f"{month}{m.group(1)}{_num(m.group(2), day.year)}", t)
    t = re.sub(rf"(?<!{_LETTER})(पाने\s*[:\-]?\s*)({_NUM})", lambda m: m.group(1) + _num(m.group(2), pages), t)
    t = re.sub(rf"(?<!{_LETTER})(पान\s*(?:क्र\.?)?\s*[:\-]?\s*)({_NUM})", lambda m: m.group(1) + _num(m.group(2), page), t)
    if volume:
        t = re.sub(rf"(?<!{_LETTER})(वर्ष\s*[:\-]?\s*)({_NUM})", lambda m: m.group(1) + _num(m.group(2), volume), t)
    if issue:
        t = re.sub(rf"(?<!{_LETTER})(अंक\s*(?:क्र\.?)?\s*[:\-]?\s*)({_NUM})", lambda m: m.group(1) + _num(m.group(2), issue), t)
    if price:
        t = re.sub(rf"(?<!{_LETTER})(किंमत\s*[:\-]?\s*(?:₹|रु\.?)?\s*)({_NUM})", lambda m: m.group(1) + _num(m.group(2), price), t)
    return _rewrite_en(t, day, page, pages, volume, issue, price) if ENGLISH else t


def _rewrite_en(t: str, day: date, page: int, pages: int, volume: str, issue: str, price: str) -> str:
    """The same words in an English running head ("Monday, 9 March 2026", "March 9, 2026", "4 pages", "Page 3",
    "Vol. 12", "No. 46", "Rs 6"), for a Latin-script paper only."""
    t = re.sub(_EN_WEEKDAY, EN_WEEKDAYS[day.weekday()], t)
    month = EN_MONTHS[day.month - 1]
    t = re.sub(rf"\b(\d{{1,2}})(\s+){_EN_MONTH}(,?\s+)(\d{{4}})(?!\d)", lambda m: f"{day.day}{m.group(2)}{month}{m.group(3)}{day.year}", t)
    t = re.sub(rf"{_EN_MONTH}(\s+)(\d{{1,2}})(,\s*)(\d{{4}})(?!\d)", lambda m: f"{month}{m.group(1)}{day.day}{m.group(3)}{day.year}", t)
    t = re.sub(r"\b(\d+)(\s+pages)\b", lambda m: f"{pages}{m.group(2)}", t)
    t = re.sub(r"\b(Page\s+)(\d+)\b", lambda m: f"{m.group(1)}{page}", t)
    if volume:
        t = re.sub(r"(?<![A-Za-z])(Vol\.?\s*)(\d+)\b", lambda m: m.group(1) + volume, t)
    if issue:
        t = re.sub(r"\b(No\.\s*)(\d+)\b", lambda m: m.group(1) + issue, t)
    if price:
        t = re.sub(r"\b((?:Rs\.?|₹)\s*)(\d+)\b", lambda m: m.group(1) + price, t)
    return t


def is_number_only(text: str) -> bool:
    return bool(re.fullmatch(_NUM, text.strip()))


def has_month(text: str) -> bool:
    return re.search(_MONTH, text) is not None or (ENGLISH and re.search(_EN_MONTH, text) is not None)
