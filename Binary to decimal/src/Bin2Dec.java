import java.util.Scanner;

public class Bin2Dec {

    public static boolean isValidBinary(String input) {
        if (input == null || input.isEmpty()) return false;
        for (int i = 0; i < input.length(); i++) {
            char c = input.charAt(i);
            if (c != '0' && c != '1') return false;
        }
        return true;
    }

    public static int binaryToDecimal(String binary) {
        int decimal = 0;
        int length = binary.length();
        for (int i = 0; i < length; i++) {
            int digit = binary.charAt(i) - '0';
            decimal += digit * (int) Math.pow(2, length - 1 - i);
        }
        return decimal;
    }

    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);

        System.out.println("=== Bin2Dec Converter ===");

        while (true) {
            System.out.print("Enter a binary number (or 'quit' to exit): ");
            String input = scanner.nextLine().trim();

            if (input.equalsIgnoreCase("quit")) break;

            if (!isValidBinary(input)) {
                System.out.println("ERROR: Only 0s and 1s are allowed.\n");
                continue;
            }

            int result = binaryToDecimal(input);
            System.out.println("Decimal: " + result + "\n");
        }

        scanner.close();
        System.out.println("Goodbye!");
    }
}