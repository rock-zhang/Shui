import { Metadata } from "next";
import { messages } from "@/i18n/messages/zh";

export const metadata: Metadata = {
  title: {
    default: messages.common.title,
    template: `%s - ${messages.common.title}`,
  },
  description: messages.settings.about.project.description,
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};
