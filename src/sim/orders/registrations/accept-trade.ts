import { acceptTrade } from '../../trade/orders.ts';
import { defineOrder } from '../define-order.ts';

export default defineOrder('acceptTrade', acceptTrade, undefined);
