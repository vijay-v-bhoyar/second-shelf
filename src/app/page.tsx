import Home from "@/components/home";
import { providerMode } from "@/server/providers";

export const dynamic = "force-dynamic";
export default function HomePage() { return <Home providerMode={providerMode()} />; }
