/**
 * Settings hub redirects to credentials as the default settings page.
 */
import { redirect } from "next/navigation";

export default function SettingsPage() {
  redirect("/settings/credentials");
}
