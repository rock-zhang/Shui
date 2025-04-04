import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <SidebarProvider open defaultOpen className="h-screen overflow-hidden">
      <AppSidebar />
      <main className="flex-1 p-10 overflow-y-auto">{children}</main>
    </SidebarProvider>
  );
}
