import { Router, type IRouter } from "express";
import healthRouter from "./health";
import signalsRouter from "./signals";
import pricesRouter from "./prices";
import marketRouter from "./market";
import tradesRouter from "./trades";
import settingsRouter from "./settings";
import listingsRouter from "./listings";
import reportsRouter from "./reports";
import sentimentRouter from "./sentiment";
import portfolioRouter from "./portfolio";
import arbitrageRouter from "./arbitrage";
import smartMoneyRouter from "./smartMoney";

const router: IRouter = Router();

router.use(healthRouter);
router.use(signalsRouter);
router.use(pricesRouter);
router.use(marketRouter);
router.use(tradesRouter);
router.use(settingsRouter);
router.use(listingsRouter);
router.use(reportsRouter);
router.use(sentimentRouter);
router.use(portfolioRouter);
router.use(arbitrageRouter);
router.use(smartMoneyRouter);

export default router;
