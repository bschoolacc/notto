import { notFound } from "next/navigation";
import QAWorkbench from "./workbench";

export default function QAPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <QAWorkbench/>;
}
