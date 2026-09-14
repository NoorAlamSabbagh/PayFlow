import { IPaymentGateway } from './paymentGateway.interface';
import { MockPaymentGatewayAdapter } from './mockPaymentGateway.adapter';
import { RazorpayPaymentGatewayAdapter } from './razorpayPaymentGateway.adapter';
import { config } from '../../../config';

export class PaymentGatewayFactory {
  private static mockInstance: MockPaymentGatewayAdapter;
  private static razorpayInstance: RazorpayPaymentGatewayAdapter;

  static getGateway(provider?: string): IPaymentGateway {
    const selectedProvider = (provider || config.paymentGateway.defaultProvider).toUpperCase();

    if (selectedProvider === 'RAZORPAY') {
      if (!this.razorpayInstance) {
        this.razorpayInstance = new RazorpayPaymentGatewayAdapter();
      }
      return this.razorpayInstance;
    }

    // Default to Mock Gateway
    if (!this.mockInstance) {
      this.mockInstance = new MockPaymentGatewayAdapter();
    }
    return this.mockInstance;
  }
}
