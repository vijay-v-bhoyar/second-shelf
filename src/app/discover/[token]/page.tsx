import Discover from "@/components/discover";
export default async function DiscoverPage({params}:{params:Promise<{token:string}>}){return <Discover token={(await params).token}/>;}
