import { BigInt, Address } from "@graphprotocol/graph-ts";
import { Token, TokenHolder } from "./generated/schema";

export const ADDRESS_ZERO = Address.zero();
const BIGINT_ZERO = BigInt.fromI32(0);

export function getOrCreateToken(tokenAddress: Address): Token {
  let token = Token.load(tokenAddress);

  if (token == null) {
    token = new Token(tokenAddress);
    token.balance = BIGINT_ZERO;
    token.holderCount = 0;
  }

  return token;
}

export function getOrCreateTokenHolder(
  tokenAddress: Address,
  holderAddress: Address
): TokenHolder {
  let holder = TokenHolder.load(holderAddress);

  if (holder == null) {
    holder = new TokenHolder(holderAddress);
    holder.token = tokenAddress;
    holder.balance = BIGINT_ZERO;
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

  // Update Token balance
  if (fromAddress.equals(ADDRESS_ZERO)) {
    // Mint
    token.balance = token.balance.plus(amount);
  } else if (toAddress.equals(ADDRESS_ZERO)) {
    // Burn
    token.balance = token.balance.minus(amount);
  }

  // Update TokenHolders
  if (!fromAddress.equals(ADDRESS_ZERO)) {
    let fromHolder = getOrCreateTokenHolder(tokenAddress, fromAddress);
    let oldBalance = fromHolder.balance;
    fromHolder.balance = fromHolder.balance.minus(amount);
    fromHolder.save();

    // Decrement holderCount if their balance drops from > 0 to 0
    if (
      oldBalance.gt(BIGINT_ZERO) &&
      fromHolder.balance.equals(BIGINT_ZERO)
    ) {
      token.holderCount = token.holderCount - 1;
    }
  }

  if (!toAddress.equals(ADDRESS_ZERO)) {
    let toHolder = getOrCreateTokenHolder(tokenAddress, toAddress);
    let oldBalance = toHolder.balance;
    toHolder.balance = toHolder.balance.plus(amount);
    toHolder.save();

    // Increment holderCount if their balance was 0 and now is > 0
    if (
      oldBalance.equals(BIGINT_ZERO) &&
      toHolder.balance.gt(BIGINT_ZERO)
    ) {
      token.holderCount = token.holderCount + 1;
    }
  }

  token.save();
}
