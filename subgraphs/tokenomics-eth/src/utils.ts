import { BigInt, Bytes, crypto, Address, ethereum } from "@graphprotocol/graph-ts";
import { Epoch, Token, TokenHolder } from "../generated/schema";

export function findEpochId(blockNumber: BigInt): string {
  // Find the current epoch based on the block number
  let epochCounter = 1;
  while (true) {
    let epochId = epochCounter.toString();
    let currentEpoch = Epoch.load(epochId);
    if (!currentEpoch) {
      break;
    }

    if (
      currentEpoch.startBlock.le(blockNumber) &&
      (currentEpoch.endBlock === null || currentEpoch.endBlock!.ge(blockNumber))
    ) {
      return currentEpoch.id;
    }

    epochCounter++;
  }

  return "";
}

// Hash abi.encode(bytes32 stakingTarget, uint256 chainId), including full-width chain IDs.
export function getNomineeHash(stakingTarget: Bytes, chainId: BigInt): Bytes {
  const nominee = new ethereum.Tuple();
  nominee.push(ethereum.Value.fromFixedBytes(stakingTarget));
  nominee.push(ethereum.Value.fromUnsignedBigInt(chainId));
  return Bytes.fromByteArray(crypto.keccak256(ethereum.encode(ethereum.Value.fromTuple(nominee))!));
}

const ADDRESS_ZERO = Address.zero();
const BIGINT_ZERO_UTIL = BigInt.fromI32(0);

function getOrCreateToken(tokenAddress: Address): Token {
  let token = Token.load(tokenAddress);

  if (token == null) {
    token = new Token(tokenAddress);
    token.balance = BIGINT_ZERO_UTIL;
    token.holderCount = 0;
  }

  return token;
}

function getOrCreateTokenHolder(
  tokenAddress: Address,
  holderAddress: Address
): TokenHolder {
  let holder = TokenHolder.load(holderAddress);

  if (holder == null) {
    holder = new TokenHolder(holderAddress);
    holder.token = tokenAddress;
    holder.balance = BIGINT_ZERO_UTIL;
  }

  return holder;
}

export function handleTransferBalances(
  tokenAddress: Address,
  fromAddress: Address,
  toAddress: Address,
  amount: BigInt
): void {
  let token = getOrCreateToken(tokenAddress);

  if (fromAddress.equals(ADDRESS_ZERO)) {
    token.balance = token.balance.plus(amount);
  } else if (toAddress.equals(ADDRESS_ZERO)) {
    token.balance = token.balance.minus(amount);
  }

  if (!fromAddress.equals(ADDRESS_ZERO)) {
    let fromHolder = getOrCreateTokenHolder(tokenAddress, fromAddress);
    let oldBalance = fromHolder.balance;
    fromHolder.balance = fromHolder.balance.minus(amount);
    fromHolder.save();

    if (
      oldBalance.gt(BIGINT_ZERO_UTIL) &&
      fromHolder.balance.equals(BIGINT_ZERO_UTIL)
    ) {
      token.holderCount = token.holderCount - 1;
    }
  }

  if (!toAddress.equals(ADDRESS_ZERO)) {
    let toHolder = getOrCreateTokenHolder(tokenAddress, toAddress);
    let oldBalance = toHolder.balance;
    toHolder.balance = toHolder.balance.plus(amount);
    toHolder.save();

    if (
      oldBalance.equals(BIGINT_ZERO_UTIL) &&
      toHolder.balance.gt(BIGINT_ZERO_UTIL)
    ) {
      token.holderCount = token.holderCount + 1;
    }
  }

  token.save();
}
