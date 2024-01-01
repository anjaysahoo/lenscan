import Image from "next/image"
import Link from "next/link"
import { FaTelegram } from "react-icons/fa"
import { FaXTwitter } from "react-icons/fa6"

import { siteConfig } from "@/config/site"

const navigation = [
  {
    name: "Twitter",
    href: siteConfig.links.twitter,
    icon: <FaXTwitter className="h-4 w-4" />,
  },
  {
    name: "Hey",
    href: siteConfig.links.lenster,
    icon: <Image src="/apps/hey.png" width="20" height="20" alt="hey" />,
  },
  {
    name: "Telegram",
    href: siteConfig.links.telegram,
    icon: <FaTelegram className="h-4 w-4" />,
  },
]

export default function Footer() {
  return (
    <footer className="container my-4">
      <div className="md:flex md:items-center md:justify-between ">
        <div className="flex items-center gap-4 md:order-2">
          {navigation.map((item) => (
            <Link key={item.name} href={item.href}>
              <span className="sr-only">{item.name}</span>
              {item.icon}
            </Link>
          ))}
        </div>
        <div className="mt-8 font-medium md:order-1 md:mt-0">
          <p className="text-center leading-5 text-muted-foreground">
            &copy; 2023 lenscan. Made with ☘️ by
            <Link
              href={siteConfig.links.lenster}
              className="ml-1 font-bold underline"
            >
              daoleno
            </Link>
          </p>
        </div>
      </div>
    </footer>
  )
}
