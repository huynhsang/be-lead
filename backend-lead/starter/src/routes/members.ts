import { Router } from 'express';
import { z } from 'zod';
import * as memberService from '../services/memberService';
import { idSchema } from './schemas';

/**
 * Member routes mounted at `/members`.
 *
 * @remarks POST `/` creates a member and zero-balance wallet (201).
 * GET `/:memberId/wallet` returns balance and turnover counters, or 404 if absent.
 */
export const membersRouter = Router();

const createMemberBody = z.object({
  username: z.string().min(3).max(64),
});

membersRouter.post('/', async (req, res, next) => {
  try {
    const body = createMemberBody.parse(req.body);
    const { member, wallet } = await memberService.createMember(body.username);
    res.status(201).json({
      member: { id: member.id, username: member.username },
      wallet: { id: wallet.id, balance: wallet.balance },
    });
  } catch (err) {
    next(err);
  }
});

membersRouter.get('/:memberId/wallet', async (req, res, next) => {
  try {
    const memberId = idSchema.parse(req.params.memberId);
    const wallet = await memberService.getWalletByMemberId(memberId);
    if (!wallet) {
      res.status(404).json({ error: 'wallet not found' });
      return;
    }
    res.json({
      id: wallet.id, memberId: wallet.memberId, balance: wallet.balance,
      requiredTurnover: wallet.requiredTurnover, accruedTurnover: wallet.accruedTurnover,
    });
  } catch (err) {
    next(err);
  }
});
