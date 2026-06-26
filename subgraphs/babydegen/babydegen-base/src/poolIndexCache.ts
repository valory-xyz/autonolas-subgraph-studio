import { Address, BigInt, log } from "@graphprotocol/graph-ts"

// Simple in-memory cache to track which NFTs belong to which pools
// This helps the Swap handler know which NFTs to refresh
// Also caches pool addresses to avoid repeated factory calls
class PoolNFTCache {
  private poolToNFTs: Map<string, BigInt[]>
  private nftToPool: Map<string, string>  // tokenId -> poolAddress for reverse lookup
  private nftToPoolAddress: Map<string, Address>  // tokenId -> poolAddress for direct lookup

  constructor() {
    this.poolToNFTs = new Map<string, BigInt[]>()
    this.nftToPool = new Map<string, string>()
    this.nftToPoolAddress = new Map<string, Address>()
  }

  addNFTToPool(protocol: string, poolAddress: Address, tokenId: BigInt): void {
    let poolKey = protocol + "-" + poolAddress.toHexString()
    let tokenKey = protocol + "-" + tokenId.toString()
    let nfts: BigInt[] = []
    
    // Check if key exists before getting
    if (this.poolToNFTs.has(poolKey)) {
      nfts = this.poolToNFTs.get(poolKey)
    }
    
    // Add if not already present
    let found = false
    for (let i = 0; i < nfts.length; i++) {
      if (nfts[i].equals(tokenId)) {
        found = true
        break
      }
    }
    
    if (!found) {
      nfts.push(tokenId)
      this.poolToNFTs.set(poolKey, nfts)
      this.nftToPool.set(tokenKey, poolKey)  // Add reverse lookup
      this.nftToPoolAddress.set(tokenKey, poolAddress)  // Cache pool address
    }
  }

  removeNFTFromPool(protocol: string, poolAddress: Address, tokenId: BigInt): void {
    let poolKey = protocol + "-" + poolAddress.toHexString()
    let tokenKey = protocol + "-" + tokenId.toString()
    
    // Check if key exists before getting
    if (this.poolToNFTs.has(poolKey)) {
      let nfts = this.poolToNFTs.get(poolKey)
      let newNfts: BigInt[] = []
      for (let i = 0; i < nfts.length; i++) {
        if (!nfts[i].equals(tokenId)) {
          newNfts.push(nfts[i])
        }
      }
      this.poolToNFTs.set(poolKey, newNfts)
      this.nftToPool.delete(tokenKey)  // Remove reverse lookup
      this.nftToPoolAddress.delete(tokenKey)  // Remove pool address cache
    }
  }

  isNFTInCache(protocol: string, tokenId: BigInt): bool {
    let tokenKey = protocol + "-" + tokenId.toString()
    return this.nftToPool.has(tokenKey)
  }

  getNFTsForPool(protocol: string, poolAddress: Address): BigInt[] {
    let poolKey = protocol + "-" + poolAddress.toHexString()
    
    // Check if key exists before getting
    if (this.poolToNFTs.has(poolKey)) {
      return this.poolToNFTs.get(poolKey)
    }
    
    return []
  }

  getCachedPoolAddress(protocol: string, tokenId: BigInt): Address | null {
    let tokenKey = protocol + "-" + tokenId.toString()
    
    if (this.nftToPoolAddress.has(tokenKey)) {
      return this.nftToPoolAddress.get(tokenKey)
    }
    
    return null
  }

  cachePoolAddress(protocol: string, tokenId: BigInt, poolAddress: Address): void {
    let tokenKey = protocol + "-" + tokenId.toString()
    this.nftToPoolAddress.set(tokenKey, poolAddress)
  }
}

// Global cache instance
let cache = new PoolNFTCache()

// Exported functions
export function addAgentNFTToPool(protocol: string, poolAddress: Address, tokenId: BigInt): void {
  cache.addNFTToPool(protocol, poolAddress, tokenId)
}

export function removeAgentNFTFromPool(protocol: string, poolAddress: Address, tokenId: BigInt): void {
  cache.removeNFTFromPool(protocol, poolAddress, tokenId)
}

export function getAgentNFTsInPool(protocol: string, poolAddress: Address): BigInt[] {
  return cache.getNFTsForPool(protocol, poolAddress)
}

export function isSafeOwnedNFT(protocol: string, tokenId: BigInt): bool {
  // Use the reverse lookup to check if Safe owns this NFT
  // Since we only track Safe-owned NFTs in the cache, if it's found, Safe owns it
  const isInCache = cache.isNFTInCache(protocol, tokenId)
  return isInCache
}

// Pool address caching functions
export function getCachedPoolAddress(protocol: string, tokenId: BigInt): Address | null {
  return cache.getCachedPoolAddress(protocol, tokenId)
}

export function cachePoolAddress(protocol: string, tokenId: BigInt, poolAddress: Address): void {
  cache.cachePoolAddress(protocol, tokenId, poolAddress)
}
