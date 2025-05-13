import { createIntl } from "@formatjs/intl";

export type Locale = "en" | "zh";

export const locales: Locale[] = ["en", "zh"];
export const defaultLocale: Locale = "en";

export type Messages = {
  common: {
    title: string;
    settings: string;
    reminder: string;
    language: string;
  };
  settings: {
    title: string;
    autoStart: {
      title: string;
      description: string;
    };
    countdown: {
      title: string;
      description: string;
    };
    fullScreen: {
      title: string;
      description: string;
    };
    reminder: {
      title: string;
      dailyGoal: {
        title: string;
        description: string;
        placeholder: string;
        suggestion: string;
      };
      interval: {
        title: string;
        placeholder: string;
        unit: string;
      };
      repeat: {
        title: string;
        description: string;
        days: string[];
      };
      timeRange: {
        title: string;
        description: string;
        start: string;
        end: string;
        to: string;
      };
      whitelist: {
        title: string;
        description: string;
        placeholder: string;
        searchPlaceholder: string;
      };
    };
    shortcut: {
      title: string;
    };
    about: {
      title: string;
    };
  };
  reminder: {
    title: string;
    autoClose: string;
    skip: string;
    today: {
      drunk: string;
      target: string;
    };
    notification: {
      title: string;
      body: string;
    };
    messages: Record<string, string>;
  };
};

export async function getMessages(locale: Locale): Promise<Messages> {
  const messages = await import(`./messages/${locale}.json`);
  return messages.default;
}

type NestedMessages = {
  [key: string]: string | string[] | NestedMessages;
};

function flattenMessages(
  nestedMessages: NestedMessages,
  prefix = ""
): Record<string, string | string[]> {
  return Object.keys(nestedMessages).reduce(
    (messages: Record<string, string | string[]>, key) => {
      const value = nestedMessages[key];
      const prefixedKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === "string" || Array.isArray(value)) {
        messages[prefixedKey] = value;
      } else {
        Object.assign(messages, flattenMessages(value, prefixedKey));
      }

      return messages;
    },
    {}
  );
}

export function createI18n(locale: Locale, messages: Messages) {
  const flattenedMessages = flattenMessages(messages);
  const stringMessages: Record<string, string> = {};

  // 将数组类型的消息转换为字符串
  Object.entries(flattenedMessages).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      stringMessages[key] = JSON.stringify(value);
    } else {
      stringMessages[key] = value;
    }
  });

  return createIntl({
    locale,
    messages: stringMessages,
    defaultLocale,
  });
}
