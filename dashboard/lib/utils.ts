import {
	NftImageFragment,
	ProfilePictureSetFragment,
} from "@lens-protocol/client"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import * as timeago from "timeago.js"

export function shortHash(hash: string | undefined, length = 10) {
	if (!hash) {
		return "-"
	}
	return `${hash.slice(0, length)}...`
}

export function age(ts: number | undefined | null) {
	if (!ts) {
		return "-"
	}
	return timeago.format(ts * 1000)
}

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

export function formatNumber(n: number | string) {
	const formatter = new Intl.NumberFormat("en-US", {
		maximumFractionDigits: 2,
	})
	return formatter.format(Number(n))
}

// format any POST_CREATED style to PostCreated style
export function formatEventType(type: string | null) {
	if (!type) {
		return "-"
	}
	return type
		.split("_")
		.map((w) => w[0] + w.slice(1).toLowerCase())
		.join("")
}

const ipfsGateway = "https://lens.infura-ipfs.io"

export function processIPFSURL(uri: string | null | undefined) {
	if (uri && uri.startsWith("ipfs://")) {
		const cid = uri.replace("ipfs://", "")
		return `${ipfsGateway}/ipfs/${cid}`
	}
	return uri
}

export function getIPFSURL(
	picture: ProfilePictureSetFragment | NftImageFragment | string | null,
) {
	if (typeof picture === "string") {
		return processIPFSURL(picture)
	}

	let uri
	if (!picture) {
		return uri
	}

	if (picture.__typename === "ImageSet") {
		uri = picture?.optimized?.uri
	}
	if (picture.__typename === "NftImage") {
		uri = picture.image.optimized?.uri
	}

	return processIPFSURL(uri)
}

export function isPublicationId(input: string): boolean {
	// Define the regex pattern to match the ID formats
	const pattern =
		/^0x[0-9A-Fa-f]+-0x[0-9A-Fa-f]+(-[0-9A-Fa-fDA]+-[0-9A-Fa-f]+)?$/

	// Test the input against the pattern
	return pattern.test(input)
}
