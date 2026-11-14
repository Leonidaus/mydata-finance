import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import type { TransactionCategory } from "@mydata/shared";

export const LOCALES = ["en", "fi"] as const;
export type Locale = (typeof LOCALES)[number];

const LANGUAGE_STORAGE_KEY = "mydata.locale.v1";

// Keep these keys stable. Components must refer to a key, never to an English sentence.
const en = {
  "app.title": "Money coach",
  "app.titleSuffix": "S-Pankki prototype",
  "language.switch": "Switch language to {{language}}",
  "language.english": "English",
  "language.finnish": "Finnish",
  "demo.customer": "Demo customer",
  "demo.customerSelect": "Whose data to show",
  "demo.personas": "Personas",
  "demo.otherCustomers": "Other customers",
  "demo.random": "Random",
  "demo.randomTitle": "Random customer",
  "demo.coaching": "Coaching",
  "demo.coachingTitle": "Change coaching settings",
  "dashboard.label": "Your dashboard",
  "dashboard.gallery": "Component gallery",
  "dashboard.loading": "Loading your data…",
  "dashboard.reset": "Reset dashboard",
  "dashboard.dataUpTo": "data up to {{date}}",
  "dashboard.customer": "Customer {{id}}, age {{age}}",
  "chat.open": "Open chat with your money coach",
  "chat.openTitle": "Open chat",
  "chat.label": "Chat with your money coach",
  "chat.resize": "Resize chat panel; drag up or down, or use arrow keys",
  "chat.resizeTitle": "Drag to resize chat",
  "chat.minimize": "Minimize chat",
  "chat.name": "Chat",
  "chat.suggestedQuestions": "Suggested questions (answered instantly)",
  "chat.suggestedSteps": "Suggested next steps",
  "chat.placeholder": "Ask about your money…",
  "chat.question": "Your question",
  "chat.ask": "Ask",
  "chat.thinking": "Thinking…",
  "chat.looking": "Let me look at your figures…",
  "chat.showAnyway": "Show it anyway",
  "chat.error": "I couldn't answer that: {{error}} Please ask again.",
  "chat.loadError": "I couldn't load your data. Use “Try again” above first.",
  "chat.stillLoading": "Still loading your data…",
  "chat.voiceEnable": "Activate voice prompt",
  "chat.voiceDisable": "Disable voice prompt",
  "chat.voiceTranscribing": "Transcribing your question…",
  "chat.voiceListening": "Listening… I'll answer when you pause.",
  "chat.voicePaused": "Voice is paused while your coach answers…",
  "chat.voiceOn": "Voice on. Start speaking.",
  "chat.modeMock": "Demo coach: keyword-based. Set GEMINI_API_KEY (in .env for the backend, or packages/app/.env.local for dev mode) to use Gemini.",
  "chat.modeBrowser": "Typed questions go to Gemini. It sees totals worked out from your account, never single transactions. Chips are instant keyword answers.",
  "card.source.own": "Your data",
  "card.source.peer": "Peer average",
  "card.source.public": "Statistics Finland",
  "card.source.estimate": "Estimate",
  "card.pin": "Pin",
  "card.pinned": "Pinned",
  "card.pinTitle": "Pin this card in the coach's context",
  "card.unpinTitle": "Unpin this card in the coach's context",
  "card.remove": "Remove {{title}}",
  "card.loading": "Loading…",
  "card.showTransactions": "Show the transactions behind this",
  "card.payment": "Payment",
  "card.usually": "Usually",
  "card.day": "day {{day}}",
  "card.goalProgress": "of the goal",
  "card.precautionNote": "This suggestion leaves some money available for unexpected costs and possible changes in payday.",
  "card.calcToggle": "How this suggestion was calculated",
  "card.precautionPlanning": "The amounts kept available are planning assumptions, not charges or payments.",
  "card.coveredByReserve": "{{amount}} covered by your reserve",
  "card.unknownTemplate": "Unknown template {{template}}.",
  "controls.period": "Period",
  "drawer.close": "Close",
  "drawer.transactions": "{{count}} transactions",
  "drawer.total": "total",
  "drawer.latestTotal": "total of the latest {{count}}",
  "drawer.loading": "Loading transactions…",
  "drawer.showing": "Showing the latest {{shown}} of {{count}}.",
  "drawer.empty": "No transactions match.",
  "error.retry": "Try again",
  "coach.settings": "Coaching settings",
  "coach.setup": "Set up your coach",
  "coach.how": "How should I coach you?",
  "coach.skip": "Skip",
  "coach.next": "Next",
  "coach.back": "Back",
  "coach.save": "Save",
  "coach.saving": "Saving…",
  "coach.protect": "Anything you would rather not cut?",
  "coach.essentials": "Essentials {{symbol}}",
  "coach.essentialHelp": "Savings ideas already skip these. Tap to also protect them from what-if questions.",
  "coach.stopKeeping": "Stop keeping {{category}} as is?",
  "coach.stopKeepingAction": "Stop keeping it",
  "coach.keep": "Keep it",
  "coach.style.encouraging": "Warm and steady",
  "coach.style.direct": "Short and plain",
  "coach.style.exploratory": "Curious and open",
  "coach.face.happy": "Your coach, smiling",
  "coach.face.proud": "Your coach, proud of you",
  "coach.face.concerned": "Your coach, concerned",
  "coach.face.neutral": "Your coach",
  "coach.face.thinking": "Your coach, thinking",
  "chat.voiceListeningStop": "Listening… Turn off voice when you're ready to send.",
  "chat.voiceStop": "Stop recording and transcribe",
  "chat.readingPhoto": "Reading your photo…",
  "chat.suggestedTitle": "Suggested questions",
  "chat.photoPlaceholder": "Ask about the photo…",
  "chat.photoAdd": "Add a photo of a price, a bill or a listing to your message",
  "chat.photoAddTitle": "Add a photo to your message",
  "chat.photoRetake": "Take another photo instead",
  "chat.unprotectYes": "Yes, stop keeping {{category}} as is",
  "chat.unprotectNo": "No, keep it",
  "chat.unprotectYesMessage": "Yes, take {{category}} off my keep-as-is list.",
  "chat.unprotectNoMessage": "No, keep {{category}} as it is.",
  "coach.smallPurchases": "small purchases",
  "coach.progress": "Onboarding step {{step}} of 2",
  "coach.goToStep": "Go to step {{step}}",
} as const;

const fi: Record<keyof typeof en, string> = {
  "app.title": "Rahavalmentaja",
  "app.titleSuffix": "S-Pankki-prototyyppi",
  "language.switch": "Vaihda kieleksi {{language}}",
  "language.english": "englanti",
  "language.finnish": "suomi",
  "demo.customer": "Esimerkkiasiakas",
  "demo.customerSelect": "Valitse näytettävät tiedot",
  "demo.personas": "Asiakashahmot",
  "demo.otherCustomers": "Muut asiakkaat",
  "demo.random": "Satunnainen",
  "demo.randomTitle": "Satunnainen asiakas",
  "demo.coaching": "Valmennus",
  "demo.coachingTitle": "Muuta valmennuksen asetuksia",
  "dashboard.label": "Oma näkymä",
  "dashboard.gallery": "Komponenttigalleria",
  "dashboard.loading": "Ladataan tietojasi…",
  "dashboard.reset": "Palauta näkymä",
  "dashboard.dataUpTo": "tiedot {{date}} asti",
  "dashboard.customer": "Asiakas {{id}}, {{age}} vuotta",
  "chat.open": "Avaa rahavalmentajan keskustelu",
  "chat.openTitle": "Avaa keskustelu",
  "chat.label": "Keskustele rahavalmentajasi kanssa",
  "chat.resize": "Muuta keskustelupaneelin kokoa vetämällä tai nuolinäppäimillä",
  "chat.resizeTitle": "Vedä muuttaaksesi kokoa",
  "chat.minimize": "Pienennä keskustelu",
  "chat.name": "Keskustelu",
  "chat.suggestedQuestions": "Ehdotetut kysymykset (vastataan heti)",
  "chat.suggestedSteps": "Ehdotetut seuraavat askeleet",
  "chat.placeholder": "Kysy rahoistasi…",
  "chat.question": "Kysymyksesi",
  "chat.ask": "Kysy",
  "chat.thinking": "Mietin…",
  "chat.looking": "Tarkistan lukujasi…",
  "chat.showAnyway": "Näytä silti",
  "chat.error": "En voinut vastata: {{error}} Kokeile uudelleen.",
  "chat.loadError": "Tietojasi ei voitu ladata. Valitse ensin ylhäältä ”Yritä uudelleen”.",
  "chat.stillLoading": "Tietojasi ladataan yhä…",
  "chat.voiceEnable": "Ota puhekehote käyttöön",
  "chat.voiceDisable": "Poista puhekehote käytöstä",
  "chat.voiceTranscribing": "Muunnetaan kysymystä tekstiksi…",
  "chat.voiceListening": "Kuuntelen… Vastaan, kun pidät tauon.",
  "chat.voicePaused": "Puhe on tauolla, kun valmentaja vastaa…",
  "chat.voiceOn": "Puhe käytössä. Aloita puhuminen.",
  "chat.modeMock": "Demovalmentaja toimii avainsanoilla. Ota Gemini käyttöön asettamalla GEMINI_API_KEY (taustapalvelun .env-tiedostoon tai kehitystilassa packages/app/.env.local-tiedostoon).",
  "chat.modeBrowser": "Kirjoitetut kysymykset menevät Geminille. Se näkee tililtäsi lasketut summat, ei yksittäisiä tapahtumia. Sirut ovat välittömiä avainsanavastauksia.",
  "card.source.own": "Omat tiedot",
  "card.source.peer": "Verrokkien keskiarvo",
  "card.source.public": "Tilastokeskus",
  "card.source.estimate": "Arvio",
  "card.pin": "Kiinnitä",
  "card.pinned": "Kiinnitetty",
  "card.pinTitle": "Kiinnitä kortti valmentajan kontekstiin",
  "card.unpinTitle": "Poista kortti valmentajan kontekstista",
  "card.remove": "Poista {{title}}",
  "card.loading": "Ladataan…",
  "card.showTransactions": "Näytä tämän taustalla olevat tapahtumat",
  "card.payment": "Maksu",
  "card.usually": "Yleensä",
  "card.day": "päivä {{day}}",
  "card.goalProgress": "tavoitteesta",
  "card.precautionNote": "Suositus jättää osan rahasta käyttöön yllättäviä menoja ja palkkapäivän mahdollista siirtymistä varten.",
  "card.calcToggle": "Näin tämä suositus laskettiin",
  "card.precautionPlanning": "Käyttöön jätetyt summat ovat suunnittelun oletuksia, eivät veloituksia tai maksuja.",
  "card.coveredByReserve": "{{amount}} katetaan varannostasi",
  "card.unknownTemplate": "Tuntematon pohja {{template}}.",
  "controls.period": "Ajanjakso",
  "drawer.close": "Sulje",
  "drawer.transactions": "{{count}} tapahtumaa",
  "drawer.total": "yhteensä",
  "drawer.latestTotal": "viimeisimmät {{count}} yhteensä",
  "drawer.loading": "Ladataan tapahtumia…",
  "drawer.showing": "Näytetään viimeisimmät {{shown}} / {{count}}.",
  "drawer.empty": "Yhtään tapahtumaa ei löytynyt.",
  "error.retry": "Yritä uudelleen",
  "coach.settings": "Valmennuksen asetukset",
  "coach.setup": "Ota valmentaja käyttöön",
  "coach.how": "Miten haluat, että valmennan sinua?",
  "coach.skip": "Ohita",
  "coach.next": "Seuraava",
  "coach.back": "Takaisin",
  "coach.save": "Tallenna",
  "coach.saving": "Tallennetaan…",
  "coach.protect": "Mistä et mieluummin tinkisi?",
  "coach.essentials": "Välttämättömät {{symbol}}",
  "coach.essentialHelp": "Säästöideat eivät jo valmiiksi ehdota näistä leikkaamista. Napauta, jos haluat suojata ne myös mitä jos -kysymyksiltä.",
  "coach.stopKeeping": "Lopetetaanko {{category}}-kulujen suojaaminen?",
  "coach.stopKeepingAction": "Lopeta suojaaminen",
  "coach.keep": "Pidä suojattuna",
  "coach.style.encouraging": "Lämmin ja kannustava",
  "coach.style.direct": "Lyhyt ja selkeä",
  "coach.style.exploratory": "Utelias ja avoin",
  "coach.face.happy": "Rahavalmentajasi hymyilee",
  "coach.face.proud": "Rahavalmentajasi on ylpeä sinusta",
  "coach.face.concerned": "Rahavalmentajasi on huolissaan",
  "coach.face.neutral": "Rahavalmentajasi",
  "coach.face.thinking": "Rahavalmentajasi miettii",
  "chat.voiceListeningStop": "Kuuntelen… Sammuta puhe, kun olet valmis lähettämään.",
  "chat.voiceStop": "Lopeta nauhoitus ja muunna tekstiksi",
  "chat.readingPhoto": "Luen kuvaasi…",
  "chat.suggestedTitle": "Ehdotetut kysymykset",
  "chat.photoPlaceholder": "Kysy kuvasta…",
  "chat.photoAdd": "Lisää viestiisi kuva hinnasta, laskusta tai ilmoituksesta",
  "chat.photoAddTitle": "Lisää kuva viestiisi",
  "chat.photoRetake": "Ota tilalle toinen kuva",
  "chat.unprotectYes": "Kyllä, lopeta {{category}}-kulujen suojaaminen",
  "chat.unprotectNo": "Ei, pidä suojattuna",
  "chat.unprotectYesMessage": "Kyllä, poista {{category}} suojattujen listalta.",
  "chat.unprotectNoMessage": "Ei, pidä {{category}} suojattuna.",
  "coach.smallPurchases": "pienet ostokset",
  "coach.progress": "Käyttöönoton vaihe {{step}}/2",
  "coach.goToStep": "Siirry vaiheeseen {{step}}",
};

const messages = { en, fi } as const;
export type TranslationKey = keyof typeof en;
type Values = Record<string, string | number>;

function interpolate(message: string, values: Values = {}) {
  return message.replace(/{{(\w+)}}/g, (_, name: string) => String(values[name] ?? `{{${name}}}`));
}

export function translate(locale: Locale, key: TranslationKey, values?: Values) {
  return interpolate(messages[locale][key], values);
}

const categoryNames: Record<Locale, Record<TransactionCategory, string>> = {
  en: {
    "Groceries": "Groceries", "Restaurants": "Restaurants", "Transportation": "Transportation", "Utilities": "Utilities", "Entertainment": "Entertainment", "Health": "Health", "Salary": "Salary", "Home & Tech": "Home & Tech", "Housing": "Housing", "Lifestyle": "Lifestyle", "Travel": "Travel", "Invest Deposit": "Investment deposit", "Other Income": "Other income", "Salary Sweep": "Salary sweep", "Invest Withdraw": "Investment withdrawal",
  },
  fi: {
    "Groceries": "Ruokaostokset", "Restaurants": "Ravintolat", "Transportation": "Liikkuminen", "Utilities": "Perusmaksut", "Entertainment": "Viihde", "Health": "Terveys", "Salary": "Palkka", "Home & Tech": "Koti ja tekniikka", "Housing": "Asuminen", "Lifestyle": "Elämäntyyli", "Travel": "Matkailu", "Invest Deposit": "Sijoitustalletus", "Other Income": "Muut tulot", "Salary Sweep": "Säästösiirto palkasta", "Invest Withdraw": "Sijoitusnosto",
  },
};

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: Values) => string;
  category: (value: TransactionCategory) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  setLocale: () => undefined,
  t: (key, values) => translate("en", key, values),
  category: (value) => categoryNames.en[value],
});

function initialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "fi") return saved;
  } catch {
    // Private browsing or strict storage settings: use the browser preference for this visit.
  }
  return navigator.language.toLowerCase().startsWith("fi") ? "fi" : "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `${translate(locale, "app.title")} · ${translate(locale, "app.titleSuffix")}`;
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
    } catch {
      // The selection still works for the current visit when persistent storage is unavailable.
    }
  }, [locale]);
  const value = useMemo(() => ({ locale, setLocale, t: (key: TranslationKey, values?: Values) => translate(locale, key, values), category: (item: TransactionCategory) => categoryNames[locale][item] }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  return useContext(LocaleContext);
}
