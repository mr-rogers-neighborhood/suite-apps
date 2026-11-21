import { redirect } from "next/navigation";

export default function StartPage() {
  redirect("/explore?view=tours&tour=start&step=0");
}
