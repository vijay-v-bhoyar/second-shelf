import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"Second Shelf — a new audience for every book",description:"A cultural discovery and merchandising workspace for independent bookstores."};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to main content</a>{children}</body></html>;}
