import { redirect } from "next/navigation";

export default function StartPage() {
  redirect("/explore?view=walkthroughs&walk=start&step=0");
}
